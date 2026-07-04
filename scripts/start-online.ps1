#Requires -Version 5.0
# 画词记忆 · 后端隧道启动脚本（Cloudflare Tunnel）
# 双击「在线游玩.bat」即可启动
#
# 架构说明：
#   - 前端：部署在 Cloudflare Pages（独立域名）
#   - 后端：本地 Node.js + Cloudflare Tunnel 隧道
#
# 本脚本只负责启动后端 + 创建隧道，输出公网隧道 URL。
# 拿到 URL 后，需要去 Cloudflare Pages 项目设置里更新
# VITE_API_BASE 环境变量为此 URL，然后重新部署前端。

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- 配置 ----------
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CloudflaredDir = Join-Path $ProjectRoot ".tools"
$CloudflaredExe = Join-Path $CloudflaredDir "cloudflared.exe"
$Port = 3001
$ServerUrl = "http://localhost:$Port"

# ---------- 工具函数 ----------
function Write-Title($text) {
    Write-Host ""
    Write-Host ("=" * 56) -ForegroundColor Yellow
    Write-Host "  $text" -ForegroundColor Yellow
    Write-Host ("=" * 56) -ForegroundColor Yellow
    Write-Host ""
}

function Write-Step($text) {
    Write-Host "[步骤] " -ForegroundColor Cyan -NoNewline
    Write-Host $text
}

function Write-Ok($text) {
    Write-Host "[完成] " -ForegroundColor Green -NoNewline
    Write-Host $text
}

function Write-Err($text) {
    Write-Host "[错误] " -ForegroundColor Red -NoNewline
    Write-Host $text
}

function Write-Info($text) {
    Write-Host "[信息] " -ForegroundColor DarkGray -NoNewline
    Write-Host $text
}

# ---------- 检查 Node.js ----------
Write-Title "画词记忆 · 后端隧道启动器"
Write-Step "检查 Node.js 环境..."
try {
    $nodeVersion = node --version
    Write-Ok "Node.js $nodeVersion"
} catch {
    Write-Err "未检测到 Node.js，请先安装：https://nodejs.org"
    Read-Host "按回车键退出"
    exit 1
}

# ---------- 安装依赖 ----------
$NodeModules = Join-Path $ProjectRoot "node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Step "首次运行，安装依赖中（约 1 分钟）..."
    Push-Location $ProjectRoot
    npm install --silent
    Pop-Location
    Write-Ok "依赖安装完成"
}

# ---------- 下载 cloudflared ----------
if (-not (Test-Path $CloudflaredExe)) {
    Write-Step "首次运行，下载 cloudflared..."
    New-Item -ItemType Directory -Force -Path $CloudflaredDir | Out-Null

    $arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
    $fileName = "cloudflared-windows-$arch.exe"

    # 多个镜像源（国内加速）
    $mirrors = @(
        "https://github.com/cloudflare/cloudflared/releases/latest/download/$fileName",
        "https://ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/$fileName",
        "https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/$fileName",
        "https://mirror.ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/$fileName",
        "https://ghps.cc/https://github.com/cloudflare/cloudflared/releases/latest/download/$fileName"
    )

    $ProgressPreference = 'SilentlyContinue'
    $downloaded = $false

    foreach ($url in $mirrors) {
        Write-Info "尝试下载: $url"
        try {
            Invoke-WebRequest -Uri $url -OutFile $CloudflaredExe -UseBasicParsing -TimeoutSec 120
            # 验证文件：1. 大小 > 10MB；2. 是有效的 PE 文件（MZ 头）
            $fileSize = (Get-Item $CloudflaredExe).Length
            $isValid = $false
            if ($fileSize -gt 10000000) {
                $bytes = [System.IO.File]::ReadAllBytes($CloudflaredExe)[0..1]
                if ($bytes[0] -eq 0x4D -and $bytes[1] -eq 0x5A) {
                    $isValid = $true
                }
            }
            if ($isValid) {
                Write-Ok "cloudflared 下载完成（$([math]::Round($fileSize/1MB, 1)) MB）"
                $downloaded = $true
                break
            } else {
                Write-Info "下载文件无效（大小 $($fileSize) 字节，非有效 PE），尝试下一个镜像..."
                Remove-Item $CloudflaredExe -ErrorAction SilentlyContinue
            }
        } catch {
            Write-Info "此源失败: $($_.Exception.Message)"
            if (Test-Path $CloudflaredExe) {
                Remove-Item $CloudflaredExe -ErrorAction SilentlyContinue
            }
        }
    }

    if (-not $downloaded) {
        Write-Err "所有下载源均失败"
        Write-Host ""
        Write-Host "请手动下载 cloudflared：" -ForegroundColor Yellow
        Write-Host "  https://github.com/cloudflare/cloudflared/releases/latest/download/$fileName"
        Write-Host "并放置到: $CloudflaredDir"
        Read-Host "按回车键退出"
        exit 1
    }
} else {
    Write-Ok "cloudflared 已就绪"
}

# ---------- 配置 CORS 白名单（CF Pages 前端域名）----------
$PagesConfigPath = Join-Path $ProjectRoot ".cf-pages-domain"
$savedPagesDomain = $null
if (Test-Path $PagesConfigPath) {
    $savedPagesDomain = (Get-Content $PagesConfigPath -Raw -ErrorAction SilentlyContinue).Trim()
}

Write-Host ""
Write-Host "────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  配置 Cloudflare Pages 前端域名（用于 CORS 跨域白名单）" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────" -ForegroundColor DarkGray
if ($savedPagesDomain) {
    Write-Host "  上次保存的 Pages 域名: " -NoNewline
    Write-Host $savedPagesDomain -ForegroundColor Green
    Write-Host "  直接回车沿用此域名，或输入新域名覆盖" -ForegroundColor DarkGray
    $userInput = Read-Host "  Pages 域名（留空沿用上次）"
    if ($userInput.Trim()) {
        $savedPagesDomain = $userInput.Trim()
        [System.IO.File]::WriteAllText($PagesConfigPath, $savedPagesDomain, [System.Text.Encoding]::UTF8)
    }
} else {
    Write-Host "  首次使用，请输入你的 Cloudflare Pages 域名" -ForegroundColor White
    Write-Host "  例如: https://small-game-abc.pages.dev" -ForegroundColor DarkGray
    Write-Host "  如果还没创建 Pages 项目，直接回车跳过（仅本地访问）" -ForegroundColor DarkGray
    $userInput = Read-Host "  Pages 域名"
    if ($userInput.Trim()) {
        $savedPagesDomain = $userInput.Trim()
        [System.IO.File]::WriteAllText($PagesConfigPath, $savedPagesDomain, [System.Text.Encoding]::UTF8)
    }
}
Write-Host ""

# ---------- 启动后端 ----------
Write-Step "启动后端服务（端口 $Port）..."
$env:PORT = $Port
if ($savedPagesDomain) {
    $env:CORS_ORIGINS = $savedPagesDomain
    Write-Info "CORS 白名单: $savedPagesDomain"
}

$serverJob = Start-Job -ScriptBlock {
    param($ProjectRoot, $Port, $CorsOrigins)
    $env:PORT = $Port
    if ($CorsOrigins) { $env:CORS_ORIGINS = $CorsOrigins }
    Set-Location $ProjectRoot
    npx tsx api/server.ts 2>&1
} -ArgumentList $ProjectRoot, $Port, $savedPagesDomain

# 等待后端启动
$serverReady = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $response = Invoke-WebRequest -Uri "$ServerUrl/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $serverReady = $true
            break
        }
    } catch {
        # 继续等待
    }
}

if (-not $serverReady) {
    Write-Err "后端启动失败"
    Receive-Job $serverJob
    Read-Host "按回车键退出"
    exit 1
}
Write-Ok "后端服务已启动"

# ---------- 启动 Cloudflare Tunnel ----------
Write-Step "创建 Cloudflare Tunnel 公网通道（最多等待 90 秒）..."

# 清理可能残留的 cloudflared 进程
try {
    $staleCf = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
    if ($staleCf) {
        Write-Info "发现残留 cloudflared 进程，正在清理..."
        $staleCf | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Write-Ok "残留进程已清理"
    }
} catch {
    # 忽略
}

# 用临时日志文件捕获 cloudflared 输出
$tunnelLog = Join-Path $env:TEMP "cloudflared-tunnel.log"
$tunnelErrLog = "$tunnelLog.err"
foreach ($lf in @($tunnelLog, $tunnelErrLog)) {
    if (Test-Path $lf) {
        Remove-Item $lf -Force -ErrorAction SilentlyContinue
    }
}

$cfProcess = Start-Process -FilePath $CloudflaredExe `
    -ArgumentList "tunnel", "--url", "http://localhost:$Port", "--no-autoupdate", "--protocol", "http2" `
    -RedirectStandardOutput $tunnelLog `
    -RedirectStandardError "$tunnelLog.err" `
    -NoNewWindow `
    -PassThru

# 解析公网 URL（最多等待 90 秒）
$publicUrl = $null
$startTime = Get-Date
while (((Get-Date) - $startTime).TotalSeconds -lt 90) {
    Start-Sleep -Seconds 2
    $logContent = ""
    if (Test-Path $tunnelLog) {
        $logContent += Get-Content $tunnelLog -Raw -ErrorAction SilentlyContinue
    }
    if (Test-Path $tunnelErrLog) {
        $logContent += Get-Content $tunnelErrLog -Raw -ErrorAction SilentlyContinue
    }
    if ($logContent -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $publicUrl = $matches[0]
        break
    }
    if ($cfProcess.HasExited) {
        Write-Info "cloudflared 进程已退出，退出码: $($cfProcess.ExitCode)"
        break
    }
    $elapsed = [int]((Get-Date) - $startTime).TotalSeconds
    if ($elapsed % 15 -eq 0 -and $elapsed -gt 0) {
        Write-Info "已等待 ${elapsed} 秒..."
    }
}

if (-not $publicUrl) {
    Write-Err "Cloudflare Tunnel 创建超时"
    Write-Host ""
    Write-Host "可能原因：" -ForegroundColor Yellow
    Write-Host "  1. 网络问题（无法连接 Cloudflare 服务器）"
    Write-Host "  2. 防火墙拦截"
    Write-Host "  3. 国内网络环境需要科学上网"
    Write-Host ""
    Write-Host "cloudflared 日志：" -ForegroundColor DarkGray
    if (Test-Path $tunnelLog) {
        Get-Content $tunnelLog -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    }
    if (Test-Path $tunnelErrLog) {
        Get-Content $tunnelErrLog -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    }
    if (-not $cfProcess.HasExited) { Stop-Process -Id $cfProcess.Id -Force -ErrorAction SilentlyContinue }
    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Read-Host "按回车键退出"
    exit 1
}

Write-Ok "公网通道已创建（URL 已分配）"
Write-Step "验证公网可达性（最多等待 40 秒）..."

# 拿到 URL 后立即验证可达性
$reachable = $false
$verifyStart = Get-Date
while (((Get-Date) - $verifyStart).TotalSeconds -lt 40) {
    if ($cfProcess.HasExited) {
        Write-Err "cloudflared 进程意外退出"
        break
    }
    try {
        $curlOut = & curl.exe -sS -o $null -w "%{http_code}" -m 8 "$publicUrl/api/health" 2>$null
        if ($curlOut -eq "200") {
            $reachable = $true
            break
        } else {
            Write-Info "隧道响应 HTTP $curlOut，等待重试..."
        }
    } catch {
        # 继续等
    }
    Start-Sleep -Seconds 3
}

if ($reachable) {
    Write-Ok "公网验证通过，后端隧道可正常访问"
} else {
    Write-Err "公网验证失败：URL 已分配但 Cloudflare 边缘节点未路由到本地隧道"
    Write-Host ""
    Write-Host "可能原因：" -ForegroundColor Yellow
    Write-Host "  1. QUIC 协议被防火墙拦截"
    Write-Host "  2. HTTP/2 隧道连接未稳定建立"
    Write-Host "  3. trycloudflare.com 子域名 DNS 在你所在网络解析不到"
    Write-Host ""
    Write-Host "建议：" -ForegroundColor Cyan
    Write-Host "  - 关闭此窗口，重新双击「在线游玩.bat」会生成新的 URL，多试几次"
    Write-Host "  - 实在不行，改用本地开发模式：「启动游戏.bat」+ 手机连同一 WiFi"
    Write-Host ""
    Write-Host "当前公网 URL 仍然显示（但可能无法访问）: $publicUrl" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "按回车继续，或按 Ctrl+C 退出" -ForegroundColor Yellow
    Read-Host
}

# ---------- 生成可视化状态页面 ----------
Write-Step "生成可视化状态页面..."

# 读取 HTML 模板文件
$templatePath = Join-Path $PSScriptRoot "status-template.html"
if (-not (Test-Path $templatePath)) {
    Write-Err "状态页模板文件缺失: $templatePath"
    if (-not $cfProcess.HasExited) { Stop-Process -Id $cfProcess.Id -Force -ErrorAction SilentlyContinue }
    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Read-Host "按回车键退出"
    exit 1
}

$templateContent = Get-Content $templatePath -Raw -Encoding utf8
$statusHtml = $templateContent -replace '{{PUBLIC_URL}}', $publicUrl

$statusPath = Join-Path $ProjectRoot "online-status.html"
[System.IO.File]::WriteAllText($statusPath, $statusHtml, [System.Text.Encoding]::UTF8)

# 打开浏览器显示状态页
Start-Process $statusPath
Write-Ok "可视化状态页面已打开"

# ---------- 显示状态到控制台 ----------
Write-Title "后端隧道已就绪"
Write-Host "  公网隧道地址: " -NoNewline
Write-Host $publicUrl -ForegroundColor Green
Write-Host ""
Write-Host "  这是【后端 API 地址】，不是游戏页面地址！" -ForegroundColor Yellow
Write-Host ""
Write-Host "  接下来你需要做：" -ForegroundColor Cyan
Write-Host "    1. 复制上面的公网隧道地址" -ForegroundColor White
Write-Host "    2. 打开 Cloudflare Pages 项目 → Settings → Environment Variables" -ForegroundColor White
Write-Host "    3. 更新 VITE_API_BASE 的值为这个地址" -ForegroundColor White
Write-Host "    4. 在 Pages 项目里触发一次 Redeploy" -ForegroundColor White
Write-Host "    5. 让朋友访问你的 Pages 域名（xxx.pages.dev）即可" -ForegroundColor White
Write-Host ""
Write-Host ("─" * 56) -ForegroundColor DarkGray
Write-Host "  服务运行中，关闭此窗口将停止后端和隧道" -ForegroundColor Yellow
Write-Host ("─" * 56) -ForegroundColor DarkGray
Write-Host ""

# ---------- 监控状态 ----------
try {
    while ($true) {
        Start-Sleep -Seconds 5

        if ($serverJob.State -eq "Completed" -or $serverJob.State -eq "Failed") {
            Write-Err "后端服务已停止"
            break
        }

        if ($cfProcess.HasExited) {
            Write-Err "Cloudflare Tunnel 已断开"
            break
        }
    }
} finally {
    Write-Host ""
    Write-Host "正在停止所有服务..." -ForegroundColor Yellow
    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job $serverJob -ErrorAction SilentlyContinue
    if (-not $cfProcess.HasExited) {
        Stop-Process -Id $cfProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $statusPath) {
        Remove-Item $statusPath -ErrorAction SilentlyContinue
    }
    Write-Ok "已停止所有服务"
    Start-Sleep -Seconds 2
}
