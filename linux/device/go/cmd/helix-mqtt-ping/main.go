// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-mqtt-ping publishes one Helix request to a device and prints the response.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/helix-kit/helix-device/internal/ipc"
)

func main() {
	broker := flag.String("broker", "tcp://localhost:1883", "MQTT broker URL")
	device := flag.String("device", "smoke-dev", "device id")
	service := flag.String("service", "echo", "target service")
	method := flag.String("method", "ping", "request method")
	payload := flag.String("payload", `{"message":"hello"}`, "request payload JSON")
	timeout := flag.Duration("timeout", 5*time.Second, "wait for response")
	flag.Parse()

	inTopic := fmt.Sprintf("helix/device/%s/in", *device)
	outTopic := fmt.Sprintf("helix/device/%s/out", *device)
	got := make(chan []byte, 1)

	opts := mqtt.NewClientOptions().AddBroker(*broker).SetClientID("helix-mqtt-ping")
	c := mqtt.NewClient(opts)
	if tok := c.Connect(); tok.Wait() && tok.Error() != nil {
		die("connect: " + tok.Error().Error())
	}
	defer c.Disconnect(200)

	if tok := c.Subscribe(outTopic, 1, func(_ mqtt.Client, m mqtt.Message) {
		select {
		case got <- m.Payload():
		default:
		}
	}); tok.Wait() && tok.Error() != nil {
		die("subscribe: " + tok.Error().Error())
	}

	packet := ipc.HelixPacket{
		RequestID: "ping-" + strconv.FormatInt(time.Now().UnixNano(), 10),
		Message:   ipc.HelixMessage{Service: *service, Method: *method, Payload: json.RawMessage(*payload)},
	}
	body, _ := json.Marshal(packet)
	if tok := c.Publish(inTopic, 1, false, body); tok.Wait() && tok.Error() != nil {
		die("publish: " + tok.Error().Error())
	}
	fmt.Printf("-> %s  %s\n", inTopic, string(body))

	select {
	case resp := <-got:
		fmt.Printf("<- %s %s\n", outTopic, string(resp))
		fmt.Println("RESULT: OK")
	case <-time.After(*timeout):
		die("timeout waiting for response")
	}
}

func die(msg string) {
	fmt.Fprintln(os.Stderr, "ping error:", msg)
	os.Exit(1)
}
