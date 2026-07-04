import { io, type Socket } from "socket.io-client";

/**
 * 解析后端 Socket.io 地址。
 *
 * 部署架构：
 *   - 前端：Cloudflare Pages / GitHub Pages（独立域名）
 *   - 后端：本地 Node.js + Cloudflare Tunnel 隧道（trycloudflare.com 临时域名）
 *
 * 通过 VITE_API_BASE 环境变量在构建时注入后端地址：
 *   - 开发模式（vite dev）：不设置，默认同源（http://localhost:3001）
 *   - CF Pages 部署：在 Pages 项目设置 → Environment variables 里
 *     添加 VITE_API_BASE = https://xxx.trycloudflare.com
 *     每次本地隧道地址变了，重新触发一次 Pages 构建即可
 *
 * 注意：socket.io-client 的 io(url) 接收的是 origin（不含 /socket.io 路径）。
 */
function resolveBackendUrl(): string {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  if (envBase && envBase.trim()) {
    return envBase.replace(/\/+$/, ""); // 去掉结尾斜杠
  }
  // 开发模式默认同源（vite dev server proxy 或同源生产部署）
  return "";
}

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const backendUrl = resolveBackendUrl();
    socket = io(backendUrl, {
      autoConnect: false,
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
