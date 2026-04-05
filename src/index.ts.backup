import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app, { attachWebSocket } from "./platforms/server";
import "./platforms/telegram";

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
