import dotenv from "dotenv";
dotenv.config();

// PayAI facilitator auth (JWT) relies on WebCrypto + atob/btoa existing in the runtime.
// Node 18+ generally provides these, but we polyfill to avoid environment-specific breakage.
import { webcrypto } from "node:crypto";
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto as any;
}
if (!(globalThis as any).atob) {
  (globalThis as any).atob = (b64: string) => Buffer.from(b64, "base64").toString("binary");
}
if (!(globalThis as any).btoa) {
  (globalThis as any).btoa = (bin: string) => Buffer.from(bin, "binary").toString("base64");
}

import http from "http";
import app, { attachWebSocket } from "./platforms/server";

const PORT = process.env.PORT ?? 3001;
const server = http.createServer(app);
attachWebSocket(server);

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   Arsweep AI Agent — Running         ║
╠══════════════════════════════════════╣
║  REST  → http://localhost:${PORT}     ║
║  WS    → ws://localhost:${PORT}/ws    ║
║  TG    → polling active              ║
╚══════════════════════════════════════╝
  `);
});
