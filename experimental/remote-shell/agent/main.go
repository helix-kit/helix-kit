// Package main is the Helix remote-shell device agent: a single outbound WebSocket to the gateway forks a PTY per opened terminal and streams bytes both ways, exposing zero inbound ports.
//
// WARNING (experimental): NO authentication. Anyone who can reach the gateway UI gets a shell on this device.
package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

type openMsg struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// agentConn owns the single gateway WebSocket and serializes writes through one goroutine.
type agentConn struct {
	ws    *websocket.Conn
	shell string
	out   chan []byte

	mu       sync.Mutex
	sessions map[uint32]*session
}

type session struct {
	id   uint32
	ptmx *os.File
	cmd  *exec.Cmd
	once sync.Once
}

func main() {
	gateway := flag.String("gateway", envOr("GATEWAY_URL", "wss://helix-kit.com/__shell_agent__"), "gateway shell-agent WebSocket URL")
	agentID := flag.String("id", envOr("AGENT_ID", "default"), "agent id")
	shell := flag.String("shell", envOr("SHELL_BIN", "/bin/bash"), "shell to exec in the PTY")
	flag.Parse()

	for {
		if err := run(*gateway, *agentID, *shell); err != nil {
			log.Printf("connection lost: %v; reconnecting in 3s", err)
		}
		time.Sleep(3 * time.Second)
	}
}

func run(gateway, agentID, shell string) error {
	log.Printf("connecting to %s (id=%s shell=%s)", gateway, agentID, shell)
	ws, _, err := websocket.DefaultDialer.Dial(gateway, nil)
	if err != nil {
		return err
	}
	defer ws.Close()

	ac := &agentConn{
		ws:       ws,
		shell:    shell,
		out:      make(chan []byte, 256),
		sessions: make(map[uint32]*session),
	}

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for frame := range ac.out {
			if err := ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
				return
			}
		}
	}()

	reg, _ := json.Marshal(map[string]string{"agentId": agentID})
	ac.send(encodeFrame(fRegister, 0, reg))

	ws.SetReadLimit(8 << 20)
	for {
		_, data, err := ws.ReadMessage()
		if err != nil {
			close(ac.out)
			<-writerDone
			ac.closeAll()
			return err
		}
		ac.handle(decodeFrame(data))
	}
}

func (ac *agentConn) send(frame []byte) {
	defer func() { recover() }() // out may be closed during shutdown
	ac.out <- frame
}

func (ac *agentConn) handle(ftype byte, id uint32, payload []byte) {
	switch ftype {
	case fRegisterAck:
		log.Printf("registered with gateway")
	case fOpen:
		ac.openSession(id, payload)
	case fData:
		if s := ac.session(id); s != nil {
			s.ptmx.Write(payload)
		}
	case fResize:
		var m openMsg
		if json.Unmarshal(payload, &m) == nil {
			if s := ac.session(id); s != nil {
				pty.Setsize(s.ptmx, &pty.Winsize{Rows: m.Rows, Cols: m.Cols})
			}
		}
	case fClose:
		ac.closeSession(id)
	}
}

func (ac *agentConn) session(id uint32) *session {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	return ac.sessions[id]
}

func (ac *agentConn) openSession(id uint32, payload []byte) {
	var m openMsg
	json.Unmarshal(payload, &m)
	if m.Cols == 0 {
		m.Cols = 80
	}
	if m.Rows == 0 {
		m.Rows = 24
	}

	cmd := exec.Command(ac.shell, "-l")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: m.Rows, Cols: m.Cols})
	if err != nil {
		log.Printf("pty start failed: %v", err)
		code, _ := json.Marshal(map[string]int{"code": 1})
		ac.send(encodeFrame(fExit, id, code))
		return
	}

	s := &session{id: id, ptmx: ptmx, cmd: cmd}
	ac.mu.Lock()
	ac.sessions[id] = s
	ac.mu.Unlock()
	log.Printf("session %d opened (%dx%d)", id, m.Cols, m.Rows)

	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, rerr := ptmx.Read(buf)
			if n > 0 {
				ac.send(encodeFrame(fData, id, append([]byte(nil), buf[:n]...)))
			}
			if rerr != nil {
				break
			}
		}
		exit := 0
		if werr := cmd.Wait(); werr != nil {
			if ee, ok := werr.(*exec.ExitError); ok {
				exit = ee.ExitCode()
			} else {
				exit = 1
			}
		}
		code, _ := json.Marshal(map[string]int{"code": exit})
		ac.send(encodeFrame(fExit, id, code))
		ac.closeSession(id)
		log.Printf("session %d exited (code %d)", id, exit)
	}()
}

func (ac *agentConn) closeSession(id uint32) {
	ac.mu.Lock()
	s := ac.sessions[id]
	delete(ac.sessions, id)
	ac.mu.Unlock()
	if s != nil {
		s.close()
	}
}

func (ac *agentConn) closeAll() {
	ac.mu.Lock()
	for _, s := range ac.sessions {
		s.close()
	}
	ac.sessions = make(map[uint32]*session)
	ac.mu.Unlock()
}

func (s *session) close() {
	s.once.Do(func() {
		if s.ptmx != nil {
			s.ptmx.Close()
		}
		if s.cmd != nil && s.cmd.Process != nil {
			s.cmd.Process.Kill()
		}
	})
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
