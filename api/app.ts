/**
 * Express 应用
 *
 * 部署架构：
 *   - 前端：Cloudflare Pages（独立域名，如 xxx.pages.dev）
 *   - 后端：本地 Node.js + Cloudflare Tunnel 隧道
 *
 * CORS 通过环境变量 CORS_ORIGINS 配置允许的前端域名（逗号分隔），
 * 例如：CORS_ORIGINS=https://your-project.pages.dev,https://custom-domain.com
 */
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app: express.Application = express();

/**
 * 解析允许的 CORS 源
 * - 默认允许本地开发地址
 * - 通过 CORS_ORIGINS 环境变量添加生产环境前端域名
 */
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

console.log(`[CORS] Allowed origins: ${allowedOrigins.join(", ")}`);

app.use(
  cors({
    origin(origin, callback) {
      // 允许同源请求（如本地直接访问后端）和跨域请求（CF Pages 前端）
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS not allowed: ${origin}`), false);
      }
    },
    credentials: true,
    methods: ["GET", "POST"],
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/**
 * 健康检查
 */
app.use("/api/health", (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    message: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

/**
 * 错误处理
 */
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Express Error]", error);
  res.status(500).json({ success: false, error: "服务器内部错误" });
});

/**
 * 404
 * 前端独立部署到 CF Pages，后端不再托管静态文件
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: "API not found" });
});

export default app;
