// Drives N bytes of PTY output through the remote-shell tunnel to measure per-session bandwidth.
// Usage:  N=20971520 SHELL_WS=wss://helix-kit.com/__shell_ws__ node shell-load.mjs
import { WebSocket } from "ws";

const URL = process.env.SHELL_WS || "wss://helix-kit.com/__shell_ws__";
const N = Number(process.env.N || 20 * 1024 * 1024); // 20 MiB default
// Marker must not appear verbatim in the echoed command; bash assembles it from adjacent quoted strings at runtime.
const MARK = "HELIXEND_DONE";

const ws = new WebSocket(URL);
ws.binaryType = "nodebuffer";
let recv = 0;
let started = 0;
let tail = "";

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "resize", cols: 200, rows: 50 }));
  setTimeout(() => {
    const cmd = `head -c ${N} /dev/zero | tr '\\0' x; printf '\\nHELIX''END_DONE\\n'\n`;
    started = Date.now();
    ws.send(Buffer.from(cmd, "utf8"));
  }, 400);
});

ws.on("message", (data, isBinary) => {
  if (!isBinary) return; // text = control (exit/error)
  recv += data.length;
  tail = (tail + data.toString("latin1")).slice(-64);
  if (tail.includes(MARK)) {
    const secs = (Date.now() - started) / 1000;
    console.log(
      JSON.stringify({
        requestedN: N,
        receivedBytes: recv,
        seconds: Number(secs.toFixed(2)),
        appMbps: Number(((recv * 8) / secs / 1e6).toFixed(1)),
      }),
    );
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (e) => {
  console.error("ws error:", e.message);
  process.exit(1);
});
setTimeout(() => {
  console.log(JSON.stringify({ requestedN: N, receivedBytes: recv, timeout: true }));
  process.exit(0);
}, 180000);
