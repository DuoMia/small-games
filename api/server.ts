/**
 * 后端服务入口
 *
 * 部署架构：
 *   - 前端：Cloudflare Pages（独立域名）
 *   - 后端：本地 Node.js + Cloudflare Tunnel 隧道（trycloudflare.com）
 *
 * CORS_ORIGINS 环境变量：逗号分隔的前端域名白名单
 */
import http from "http";
import app from "./app.js";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./socket/handlers.js";
import type { ClientToServerEvents, ServerToClientEvents } from "./game/types.js";

const PORT = process.env.PORT || 3001;

const server = http.createServer(app);

// Socket.io CORS 与 Express 共用同一套白名单
const allowedOrigins: string[] = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

if (process.env.CORS_ORIGINS) {
  const extras = process.env.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  allowedOrigins.push(...extras);
}

console.log(`[Socket.io] Allowed origins: ${allowedOrigins.join(", ")}`);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Socket.io CORS not allowed: ${origin}`));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for drawing uploads
});

registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
  console.log(`📡 Socket.io 监听中（用于双人实时通信）`);
  console.log(`⏳ 等待 Cloudflare Tunnel 公网通道...`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

export default app;
