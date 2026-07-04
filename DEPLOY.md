# Cloudflare Pages 部署指南

## 架构说明

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  朋友的手机      │ ──────► │  Cloudflare Pages │ ──────► │  你的电脑（本地）│
│  浏览器访问      │         │  前端静态文件     │         │  后端 + 隧道    │
│  xxx.pages.dev  │         │  CDN 全球加速     │         │  localhost:3001 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                                            │
                                                            ▼
                                                   Cloudflare Tunnel
                                                   xxx.trycloudflare.com
```

- **前端**：构建产物上传到 Cloudflare Pages，通过 CDN 全球加速
- **后端**：跑在你本地电脑，通过 Cloudflare Tunnel 暴露公网地址
- **前端通过 Socket.io 连到后端的 Tunnel 地址**

## 一次性配置（首次部署）

### 1. 推送代码到 GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<你的用户名>/small-game.git
git push -u origin main
```

### 2. 创建 Cloudflare Pages 项目

1. 打开 https://dash.cloudflare.com → Pages → Create a project → Connect to Git
2. 选择你的 GitHub 仓库 `small-game`
3. 构建配置：
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`（留空）
4. **Environment Variables**（关键）：
   - 添加 `VITE_API_BASE` = 临时填 `https://placeholder.trycloudflare.com`
   - 添加 `CORS_ORIGINS` = 留空（后端启动脚本会处理）
   - 稍后用真实隧道地址替换
5. 点 "Save and Deploy"，等待第一次构建完成
6. 你会得到一个 Pages 域名，例如 `https://small-game-abc.pages.dev`

### 3. 在后端启动脚本里配置 CORS 白名单

打开 `d:\small-game\scripts\start-online.ps1`，找到 `# ---------- 启动后端 ----------` 这段，
在 `$env:PORT = $Port` 下面加一行（替换为你的 Pages 域名）：

```powershell
$env:PORT = $Port
$env:CORS_ORIGINS = "https://small-game-abc.pages.dev"   # 改成你的 Pages 域名
```

## 日常使用流程

### Step 1：启动后端隧道

双击 `在线游玩.bat`，脚本会：
- 启动本地后端（端口 3001）
- 创建 Cloudflare Tunnel，分配一个公网 URL
- 例如：`https://own-jesus-duke-checks.trycloudflare.com`
- 自动弹出状态页显示这个 URL

### Step 2：更新 Pages 环境变量

1. 打开 https://dash.cloudflare.com → Pages → 你的项目 → Settings → Environment Variables
2. 编辑 `VITE_API_BASE`，把值改成新的隧道地址
3. 保存

### Step 3：重新部署前端

在 Pages 项目 → Deployments，找到最近一次部署，点右侧 `...` → `Retry deployment`
等待 1-2 分钟构建完成。

### Step 4：发链接给朋友

把 Pages 域名（如 `https://small-game-abc.pages.dev`）发给朋友即可。

朋友打开的就是 Cloudflare Pages 上的前端，前端会自动连到你本地的后端隧道。

## 常见问题

### Q：为什么朋友打开 Pages 域名后白屏 / 报错？
A：检查 Pages 的环境变量 `VITE_API_BASE` 是否更新为最新的隧道地址，
并且已经 Retry deployment 触发了重新构建。

### Q：为什么 Socket.io 连接失败？
A：后端的 CORS_ORIGINS 必须包含你的 Pages 域名。
确认 `start-online.ps1` 里设置了：
```powershell
$env:CORS_ORIGINS = "https://你的项目名.pages.dev"
```

### Q：每次启动隧道地址都变怎么办？
A：这是 Cloudflare 免费版的限制。每次启动后需要：
1. 复制新的隧道地址
2. 去 Pages 设置更新 `VITE_API_BASE`
3. Retry deployment

如果想要固定地址，需要：
- 注册一个域名
- 用 `cloudflared tunnel login` 绑定账号
- 创建 named tunnel 而不是 quick tunnel

### Q：电脑关机了朋友还能玩吗？
A：不能。后端跑在你电脑上，电脑关机 = 后端停止 = 游戏无法联机。
前端 Pages 域名仍能打开，但 Socket.io 连不上后端。

### Q：能不能不用 Cloudflare Tunnel？
A：可以。后端跑在本地，前端从 CF Pages 跨域连过来。
替代方案：
- **局域网模式**：手机连同一 WiFi，访问电脑局域网 IP（零依赖，最稳）
- **Railway/Render**：后端部署到云端，固定 URL，但要钱/有限额
