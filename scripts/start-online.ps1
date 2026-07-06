#Requires -Version 5.0
# 画词记忆 · 服务管理器（GUI 版）
# 双击「在线游玩.bat」即可启动
#
# 参考 stock-helper 项目设计：
#   - Windows Forms GUI 窗口
#   - 后端 + 隧道独立启停
#   - 拿到 URL 即显示，不强制验证可达性
#   - 后台定时健康检查（仅状态显示，不阻塞）

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CloudflaredDir = Join-Path $ProjectRoot ".tools"
$CloudflaredExe = Join-Path $CloudflaredDir "cloudflared.exe"
$BackEndPort = 3001
$PagesConfigPath = Join-Path $ProjectRoot ".cf-pages-domain"

# 读取记忆的 Pages 域名
$savedPagesDomain = ""
if (Test-Path $PagesConfigPath) {
    $savedPagesDomain = (Get-Content $PagesConfigPath -Raw -ErrorAction SilentlyContinue).Trim()
}

$script:backendPid = 0
$script:tunnelPid = 0
$script:tunnelUrl = ""
$script:tunnelLogFile = Join-Path $env:TEMP "cloudflared-tunnel.log"
$script:tunnelStartTime = $null
$script:tunnelTimeoutWarned = $false
$script:pagesDomain = $savedPagesDomain

# ---------- 工具函数 ----------
function Write-Log($msg) {
    try {
        $time = Get-Date -Format "HH:mm:ss"
        if ($txtBox.IsHandleCreated) {
            $txtBox.Invoke([Action]{
                $txtBox.AppendText("[$time] $msg`r`n")
            })
        }
    } catch {}
}

function Is-ProcessRunning($procId) {
    if ($procId -le 0) { return $false }
    try {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        return $p -ne $null
    } catch { return $false }
}

function Update-Status {
    try {
        if (-not $form.IsHandleCreated) { return }
        $beRunning = Is-ProcessRunning $script:backendPid
        $tnRunning = Is-ProcessRunning $script:tunnelPid

        $form.Invoke([Action]{
            $btnStartBE.Enabled = -not $beRunning
            $btnStopBE.Enabled = $beRunning
            $lblBEStatus.Text = if ($beRunning) { "运行中" } else { "已停止" }
            $lblBEStatus.ForeColor = if ($beRunning) { [System.Drawing.Color]::LightGreen } else { [System.Drawing.Color]::Salmon }

            $btnStartTN.Enabled = -not $tnRunning
            $btnStopTN.Enabled = $tnRunning
            $lblTNStatus.Text = if ($tnRunning) { "运行中" } else { "已停止" }
            $lblTNStatus.ForeColor = if ($tnRunning) { [System.Drawing.Color]::LightGreen } else { [System.Drawing.Color]::Salmon }

            $btnStartAll.Enabled = -not ($beRunning -and $tnRunning)
            $btnStopAll.Enabled = $beRunning -or $tnRunning
        })
    } catch {}
}

# ---------- 启动/停止后端 ----------
function Start-Backend {
    if (Is-ProcessRunning $script:backendPid) {
        Write-Log "后端服务已在运行中"
        return
    }

    # 检查依赖
    $NodeModules = Join-Path $ProjectRoot "node_modules"
    if (-not (Test-Path $NodeModules)) {
        Write-Log "首次运行，安装依赖中（约 1 分钟）..."
        Push-Location $ProjectRoot
        npm install --silent
        Pop-Location
    }

    Write-Log "正在启动后端服务..."
    $env:PORT = $BackEndPort
    if ($script:pagesDomain) {
        $env:CORS_ORIGINS = $script:pagesDomain
        Write-Log "CORS 白名单: $($script:pagesDomain)"
    }

    # 加载 scripts/.env 中的环境变量（GLM_API_KEY 等），供海龟汤 AI 主持人使用
    # 该文件已被 .gitignore 忽略，不会提交到仓库
    # 注意：必须用 [System.IO.File]::ReadAllLines 强制 UTF-8 读取，
    #       PowerShell 5.x 的 Get-Content 默认按 GBK 解码 UTF-8 无 BOM 文件会出问题
    #       必须用 [System.Environment]::SetEnvironmentVariable 设置，
    #       Set-Item -Path "Env:$k" 在某些 PS 5.x 环境下不生效
    $EnvFile = Join-Path $PSScriptRoot ".env"
    if (Test-Path $EnvFile) {
        try {
            $lines = [System.IO.File]::ReadAllLines($EnvFile, [System.Text.Encoding]::UTF8)
            $loadedCount = 0
            foreach ($line in $lines) {
                $t = $line.Trim()
                if ($t -and -not $t.StartsWith("#")) {
                    $idx = $t.IndexOf("=")
                    if ($idx -gt 0) {
                        $k = $t.Substring(0, $idx).Trim()
                        $v = $t.Substring($idx + 1).Trim()
                        [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
                        $loadedCount++
                    }
                }
            }
            if ($env:GLM_API_KEY) {
                $masked = $env:GLM_API_KEY.Substring(0, [Math]::Min(8, $env:GLM_API_KEY.Length)) + "..."
                Write-Log "已加载 GLM_API_KEY（$masked，海龟汤 AI 主持人可用）"
            } else {
                Write-Log "警告: scripts/.env 中未找到 GLM_API_KEY（已解析 $loadedCount 行），海龟汤 AI 将全部返回'无关'"
            }
        } catch {
            Write-Log "读取 scripts/.env 失败: $_"
        }
    } else {
        Write-Log "提示: 未找到 scripts/.env，海龟汤 AI 主持人将不可用"
    }

    # Windows 上 npx 是 npx.cmd 批处理文件，Start-Process 需要明确指定
    # 用 cmd /c 包装最稳妥，能正确处理 PATH 查找
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx tsx api/server.ts" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
    $script:backendPid = $p.Id
    Write-Log "后端服务已启动 (PID: $($p.Id), 端口: $BackEndPort)"
    Update-Status
}

function Stop-Backend {
    if (-not (Is-ProcessRunning $script:backendPid)) {
        Write-Log "后端服务未在运行"
        return
    }
    Write-Log "正在停止后端服务..."
    try {
        Start-Process -FilePath "taskkill" -ArgumentList "/T /F /PID $($script:backendPid)" -NoNewWindow -Wait -ErrorAction SilentlyContinue | Out-Null
        $script:backendPid = 0
        Write-Log "后端服务已停止"
    } catch {
        Write-Log "停止后端失败: $_"
    }
    Update-Status
}

# ---------- 启动/停止隧道 ----------
function Start-Tunnel {
    if (Is-ProcessRunning $script:tunnelPid) {
        Write-Log "隧道已在运行中"
        return
    }
    if (-not (Test-Path $CloudflaredExe)) {
        Write-Log "错误: 未找到 cloudflared ($CloudflaredExe)"
        Write-Log "请双击「在线游玩.bat」首次运行会自动下载"
        return
    }
    Write-Log "正在启动隧道..."
    $script:tunnelUrl = ""
    $script:tunnelStartTime = Get-Date
    $script:tunnelTimeoutWarned = $false
    if (Test-Path $script:tunnelLogFile) { Remove-Item $script:tunnelLogFile -Force -ErrorAction SilentlyContinue }

    # 关键修复：用 --config 指定自定义配置文件，覆盖 ~/.cloudflared/config.yml
    # 原因：用户之前为 stock-helper 配置过 named tunnel，config.yml 中的 ingress 规则
    #       只允许 kangupiao.top 域名，导致 trycloudflare.com 请求被拦截返回 404
    # cf-quick.yml 只包含一个 catch-all ingress，把所有请求转发到本地后端
    $QuickConfigPath = Join-Path $PSScriptRoot "cf-quick.yml"
    $p = Start-Process -FilePath $CloudflaredExe -ArgumentList "tunnel","--config",$QuickConfigPath,"--url","http://localhost:$BackEndPort" -NoNewWindow -RedirectStandardError $script:tunnelLogFile -PassThru
    $script:tunnelPid = $p.Id
    Write-Log "隧道进程已启动 (PID: $($p.Id))"
    Write-Log "等待分配公网地址..."
    Update-Status
}

function Stop-Tunnel {
    if (-not (Is-ProcessRunning $script:tunnelPid)) {
        Write-Log "隧道未在运行"
        return
    }
    Write-Log "正在停止隧道..."
    try {
        Start-Process -FilePath "taskkill" -ArgumentList "/T /F /PID $($script:tunnelPid)" -NoNewWindow -Wait -ErrorAction SilentlyContinue | Out-Null
        $script:tunnelPid = 0
        $script:tunnelUrl = ""
        $script:tunnelStartTime = $null
        $script:tunnelTimeoutWarned = $false
        if ($form.IsHandleCreated) {
            $form.Invoke([Action]{ $txtUrl.Text = ""; $txtUrl2.Text = "" })
        }
        Write-Log "隧道已停止"
    } catch {
        Write-Log "停止隧道失败: $_"
    }
    Update-Status
}

# ---------- 保存 Pages 域名 ----------
function Save-PagesDomain {
    $input = $txtPagesDomain.Text.Trim()
    if ($input) {
        if ($input -notmatch '^https?://') {
            $input = "https://$input"
        }
        $script:pagesDomain = $input
        [System.IO.File]::WriteAllText($PagesConfigPath, $input, [System.Text.Encoding]::UTF8)
        Write-Log "Pages 域名已保存: $input"
        if (Is-ProcessRunning $script:backendPid) {
            Write-Log "重启后端以应用新的 CORS 白名单..."
            Stop-Backend
            Start-Backend
        }
    }
}

# ---------- 构建 GUI ----------
$form = New-Object System.Windows.Forms.Form
$form.Text = "画词记忆 · 服务管理器"
$form.Size = New-Object System.Drawing.Size(580, 600)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 46)

# 标题
$titleLbl = New-Object System.Windows.Forms.Label
$titleLbl.Text = "画词记忆 · 服务管理器"
$titleLbl.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 14, [System.Drawing.FontStyle]::Bold)
$titleLbl.ForeColor = [System.Drawing.Color]::White
$titleLbl.AutoSize = $true
$titleLbl.Location = New-Object System.Drawing.Point(20, 15)
$form.Controls.Add($titleLbl)

# Pages 域名配置区
$panelPages = New-Object System.Windows.Forms.Panel
$panelPages.Size = New-Object System.Drawing.Size(520, 65)
$panelPages.Location = New-Object System.Drawing.Point(20, 50)
$panelPages.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 65)
$form.Controls.Add($panelPages)

$lblPages = New-Object System.Windows.Forms.Label
$lblPages.Text = "Cloudflare Pages 域名（用于 CORS 白名单）"
$lblPages.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$lblPages.ForeColor = [System.Drawing.Color]::White
$lblPages.Location = New-Object System.Drawing.Point(10, 5)
$lblPages.AutoSize = $true
$panelPages.Controls.Add($lblPages)

$txtPagesDomain = New-Object System.Windows.Forms.TextBox
$txtPagesDomain.Text = $savedPagesDomain
$txtPagesDomain.Font = New-Object System.Drawing.Font("Consolas", 9)
$txtPagesDomain.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 46)
$txtPagesDomain.ForeColor = [System.Drawing.Color]::FromArgb(129, 199, 132)
$txtPagesDomain.BorderStyle = "FixedSingle"
$txtPagesDomain.Location = New-Object System.Drawing.Point(10, 28)
$txtPagesDomain.Size = New-Object System.Drawing.Size(380, 22)
$panelPages.Controls.Add($txtPagesDomain)

$btnSavePages = New-Object System.Windows.Forms.Button
$btnSavePages.Text = "保存"
$btnSavePages.Size = New-Object System.Drawing.Size(55, 24)
$btnSavePages.Location = New-Object System.Drawing.Point(400, 27)
$btnSavePages.BackColor = [System.Drawing.Color]::FromArgb(70, 70, 90)
$btnSavePages.ForeColor = [System.Drawing.Color]::White
$btnSavePages.FlatStyle = "Flat"
$btnSavePages.Add_Click({ Save-PagesDomain })
$panelPages.Controls.Add($btnSavePages)

$lblPagesHint = New-Object System.Windows.Forms.Label
$lblPagesHint.Text = "格式: https://xxx.pages.dev  保存后若后端在运行会自动重启"
$lblPagesHint.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 7)
$lblPagesHint.ForeColor = [System.Drawing.Color]::Gray
$lblPagesHint.Location = New-Object System.Drawing.Point(10, 55)
$lblPagesHint.AutoSize = $true
$panelPages.Controls.Add($lblPagesHint)

# 后端服务面板
$panelBE = New-Object System.Windows.Forms.Panel
$panelBE.Size = New-Object System.Drawing.Size(520, 70)
$panelBE.Location = New-Object System.Drawing.Point(20, 125)
$panelBE.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 65)
$form.Controls.Add($panelBE)

$lblBE = New-Object System.Windows.Forms.Label
$lblBE.Text = "后端服务"
$lblBE.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10, [System.Drawing.FontStyle]::Bold)
$lblBE.ForeColor = [System.Drawing.Color]::White
$lblBE.Location = New-Object System.Drawing.Point(10, 5)
$lblBE.AutoSize = $true
$panelBE.Controls.Add($lblBE)

$lblBEStatus = New-Object System.Windows.Forms.Label
$lblBEStatus.Text = "已停止"
$lblBEStatus.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$lblBEStatus.ForeColor = [System.Drawing.Color]::Salmon
$lblBEStatus.Location = New-Object System.Drawing.Point(90, 7)
$lblBEStatus.AutoSize = $true
$panelBE.Controls.Add($lblBEStatus)

$lblBEHealth = New-Object System.Windows.Forms.Label
$lblBEHealth.Text = ""
$lblBEHealth.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 8)
$lblBEHealth.ForeColor = [System.Drawing.Color]::Gray
$lblBEHealth.Location = New-Object System.Drawing.Point(10, 28)
$lblBEHealth.AutoSize = $true
$panelBE.Controls.Add($lblBEHealth)

$btnStartBE = New-Object System.Windows.Forms.Button
$btnStartBE.Text = "启动"
$btnStartBE.Size = New-Object System.Drawing.Size(70, 28)
$btnStartBE.Location = New-Object System.Drawing.Point(360, 5)
$btnStartBE.BackColor = [System.Drawing.Color]::FromArgb(76, 175, 80)
$btnStartBE.ForeColor = [System.Drawing.Color]::White
$btnStartBE.FlatStyle = "Flat"
$btnStartBE.Add_Click({ Start-Backend })
$panelBE.Controls.Add($btnStartBE)

$btnStopBE = New-Object System.Windows.Forms.Button
$btnStopBE.Text = "停止"
$btnStopBE.Size = New-Object System.Drawing.Size(70, 28)
$btnStopBE.Location = New-Object System.Drawing.Point(435, 5)
$btnStopBE.BackColor = [System.Drawing.Color]::FromArgb(244, 67, 54)
$btnStopBE.ForeColor = [System.Drawing.Color]::White
$btnStopBE.FlatStyle = "Flat"
$btnStopBE.Enabled = $false
$btnStopBE.Add_Click({ Stop-Backend })
$panelBE.Controls.Add($btnStopBE)

$lblBEPort = New-Object System.Windows.Forms.Label
$lblBEPort.Text = "端口: $BackEndPort  |  npx tsx api/server.ts"
$lblBEPort.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 7)
$lblBEPort.ForeColor = [System.Drawing.Color]::Gray
$lblBEPort.Location = New-Object System.Drawing.Point(10, 48)
$lblBEPort.AutoSize = $true
$panelBE.Controls.Add($lblBEPort)

# 隧道面板
$panelTN = New-Object System.Windows.Forms.Panel
$panelTN.Size = New-Object System.Drawing.Size(520, 70)
$panelTN.Location = New-Object System.Drawing.Point(20, 205)
$panelTN.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 65)
$form.Controls.Add($panelTN)

$lblTN = New-Object System.Windows.Forms.Label
$lblTN.Text = "Cloudflare Tunnel"
$lblTN.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10, [System.Drawing.FontStyle]::Bold)
$lblTN.ForeColor = [System.Drawing.Color]::White
$lblTN.Location = New-Object System.Drawing.Point(10, 5)
$lblTN.AutoSize = $true
$panelTN.Controls.Add($lblTN)

$lblTNStatus = New-Object System.Windows.Forms.Label
$lblTNStatus.Text = "已停止"
$lblTNStatus.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$lblTNStatus.ForeColor = [System.Drawing.Color]::Salmon
$lblTNStatus.Location = New-Object System.Drawing.Point(140, 7)
$lblTNStatus.AutoSize = $true
$panelTN.Controls.Add($lblTNStatus)

$lblTNHealth = New-Object System.Windows.Forms.Label
$lblTNHealth.Text = ""
$lblTNHealth.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 8)
$lblTNHealth.ForeColor = [System.Drawing.Color]::Gray
$lblTNHealth.Location = New-Object System.Drawing.Point(10, 28)
$lblTNHealth.AutoSize = $true
$panelTN.Controls.Add($lblTNHealth)

$btnStartTN = New-Object System.Windows.Forms.Button
$btnStartTN.Text = "启动"
$btnStartTN.Size = New-Object System.Drawing.Size(70, 28)
$btnStartTN.Location = New-Object System.Drawing.Point(360, 5)
$btnStartTN.BackColor = [System.Drawing.Color]::FromArgb(76, 175, 80)
$btnStartTN.ForeColor = [System.Drawing.Color]::White
$btnStartTN.FlatStyle = "Flat"
$btnStartTN.Add_Click({ Start-Tunnel })
$panelTN.Controls.Add($btnStartTN)

$btnStopTN = New-Object System.Windows.Forms.Button
$btnStopTN.Text = "停止"
$btnStopTN.Size = New-Object System.Drawing.Size(70, 28)
$btnStopTN.Location = New-Object System.Drawing.Point(435, 5)
$btnStopTN.BackColor = [System.Drawing.Color]::FromArgb(244, 67, 54)
$btnStopTN.ForeColor = [System.Drawing.Color]::White
$btnStopTN.FlatStyle = "Flat"
$btnStopTN.Enabled = $false
$btnStopTN.Add_Click({ Stop-Tunnel })
$panelTN.Controls.Add($btnStopTN)

$lblTNDesc = New-Object System.Windows.Forms.Label
$lblTNDesc.Text = "将本地后端暴露到公网（临时 trycloudflare.com 域名）"
$lblTNDesc.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 7)
$lblTNDesc.ForeColor = [System.Drawing.Color]::Gray
$lblTNDesc.Location = New-Object System.Drawing.Point(10, 48)
$lblTNDesc.AutoSize = $true
$panelTN.Controls.Add($lblTNDesc)

# 全局按钮
$btnStartAll = New-Object System.Windows.Forms.Button
$btnStartAll.Text = "全部启动"
$btnStartAll.Size = New-Object System.Drawing.Size(110, 32)
$btnStartAll.Location = New-Object System.Drawing.Point(20, 285)
$btnStartAll.BackColor = [System.Drawing.Color]::FromArgb(33, 150, 243)
$btnStartAll.ForeColor = [System.Drawing.Color]::White
$btnStartAll.FlatStyle = "Flat"
$btnStartAll.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$btnStartAll.Add_Click({ Start-Backend; Start-Tunnel })
$form.Controls.Add($btnStartAll)

$btnStopAll = New-Object System.Windows.Forms.Button
$btnStopAll.Text = "全部停止"
$btnStopAll.Size = New-Object System.Drawing.Size(110, 32)
$btnStopAll.Location = New-Object System.Drawing.Point(140, 285)
$btnStopAll.BackColor = [System.Drawing.Color]::FromArgb(244, 67, 54)
$btnStopAll.ForeColor = [System.Drawing.Color]::White
$btnStopAll.FlatStyle = "Flat"
$btnStopAll.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$btnStopAll.Enabled = $false
$btnStopAll.Add_Click({ Stop-Tunnel; Stop-Backend })
$form.Controls.Add($btnStopAll)

$btnRestart = New-Object System.Windows.Forms.Button
$btnRestart.Text = "重启服务"
$btnRestart.Size = New-Object System.Drawing.Size(110, 32)
$btnRestart.Location = New-Object System.Drawing.Point(260, 285)
$btnRestart.BackColor = [System.Drawing.Color]::FromArgb(255, 152, 0)
$btnRestart.ForeColor = [System.Drawing.Color]::White
$btnRestart.FlatStyle = "Flat"
$btnRestart.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$btnRestart.Add_Click({ Stop-Tunnel; Stop-Backend; Start-Backend; Start-Tunnel })
$form.Controls.Add($btnRestart)

$btnOpenCF = New-Object System.Windows.Forms.Button
$btnOpenCF.Text = "CF 控制台"
$btnOpenCF.Size = New-Object System.Drawing.Size(110, 32)
$btnOpenCF.Location = New-Object System.Drawing.Point(380, 285)
$btnOpenCF.BackColor = [System.Drawing.Color]::FromArgb(255, 193, 7)
$btnOpenCF.ForeColor = [System.Drawing.Color]::Black
$btnOpenCF.FlatStyle = "Flat"
$btnOpenCF.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$btnOpenCF.Add_Click({
    Start-Process "https://dash.cloudflare.com/?to=/:account/pages"
    Write-Log "已打开 Cloudflare Pages 控制台"
})
$form.Controls.Add($btnOpenCF)

# URL 显示区
$panelUrl = New-Object System.Windows.Forms.Panel
$panelUrl.Size = New-Object System.Drawing.Size(520, 110)
$panelUrl.Location = New-Object System.Drawing.Point(20, 330)
$panelUrl.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 65)
$form.Controls.Add($panelUrl)

$lblUrl = New-Object System.Windows.Forms.Label
$lblUrl.Text = "隧道公网地址"
$lblUrl.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$lblUrl.ForeColor = [System.Drawing.Color]::White
$lblUrl.Location = New-Object System.Drawing.Point(10, 5)
$lblUrl.AutoSize = $true
$panelUrl.Controls.Add($lblUrl)

$txtUrl = New-Object System.Windows.Forms.TextBox
$txtUrl.Text = ""
$txtUrl.Font = New-Object System.Drawing.Font("Consolas", 9)
$txtUrl.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 46)
$txtUrl.ForeColor = [System.Drawing.Color]::FromArgb(129, 199, 132)
$txtUrl.BorderStyle = "None"
$txtUrl.Location = New-Object System.Drawing.Point(10, 27)
$txtUrl.Size = New-Object System.Drawing.Size(410, 20)
$txtUrl.ReadOnly = $true
$panelUrl.Controls.Add($txtUrl)

$btnCopyUrl = New-Object System.Windows.Forms.Button
$btnCopyUrl.Text = "复制"
$btnCopyUrl.Size = New-Object System.Drawing.Size(55, 22)
$btnCopyUrl.Location = New-Object System.Drawing.Point(430, 26)
$btnCopyUrl.BackColor = [System.Drawing.Color]::FromArgb(70, 70, 90)
$btnCopyUrl.ForeColor = [System.Drawing.Color]::White
$btnCopyUrl.FlatStyle = "Flat"
$btnCopyUrl.Add_Click({
    if ($script:tunnelUrl) {
        [System.Windows.Forms.Clipboard]::SetText($script:tunnelUrl)
        Write-Log "已复制隧道地址到剪贴板"
    }
})
$panelUrl.Controls.Add($btnCopyUrl)

$lblUrl2 = New-Object System.Windows.Forms.Label
$lblUrl2.Text = "VITE_API_BASE (填入 Pages 环境变量):"
$lblUrl2.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 8)
$lblUrl2.ForeColor = [System.Drawing.Color]::Gray
$lblUrl2.Location = New-Object System.Drawing.Point(10, 55)
$lblUrl2.AutoSize = $true
$panelUrl.Controls.Add($lblUrl2)

$txtUrl2 = New-Object System.Windows.Forms.TextBox
$txtUrl2.Text = ""
$txtUrl2.Font = New-Object System.Drawing.Font("Consolas", 8)
$txtUrl2.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 46)
$txtUrl2.ForeColor = [System.Drawing.Color]::FromArgb(129, 199, 132)
$txtUrl2.BorderStyle = "None"
$txtUrl2.Location = New-Object System.Drawing.Point(10, 75)
$txtUrl2.Size = New-Object System.Drawing.Size(410, 18)
$txtUrl2.ReadOnly = $true
$panelUrl.Controls.Add($txtUrl2)

$btnCopyUrl2 = New-Object System.Windows.Forms.Button
$btnCopyUrl2.Text = "复制"
$btnCopyUrl2.Size = New-Object System.Drawing.Size(55, 18)
$btnCopyUrl2.Location = New-Object System.Drawing.Point(430, 74)
$btnCopyUrl2.BackColor = [System.Drawing.Color]::FromArgb(70, 70, 90)
$btnCopyUrl2.ForeColor = [System.Drawing.Color]::White
$btnCopyUrl2.FlatStyle = "Flat"
$btnCopyUrl2.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 7)
$btnCopyUrl2.Add_Click({
    if ($script:tunnelUrl) {
        [System.Windows.Forms.Clipboard]::SetText($script:tunnelUrl)
        Write-Log "已复制 VITE_API_BASE 到剪贴板"
    }
})
$panelUrl.Controls.Add($btnCopyUrl2)

# 日志区
$lblLogTitle = New-Object System.Windows.Forms.Label
$lblLogTitle.Text = "运行日志"
$lblLogTitle.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$lblLogTitle.ForeColor = [System.Drawing.Color]::White
$lblLogTitle.Location = New-Object System.Drawing.Point(20, 450)
$lblLogTitle.AutoSize = $true
$form.Controls.Add($lblLogTitle)

$txtBox = New-Object System.Windows.Forms.TextBox
$txtBox.Multiline = $true
$txtBox.ScrollBars = "Vertical"
$txtBox.Font = New-Object System.Drawing.Font("Consolas", 8)
$txtBox.BackColor = [System.Drawing.Color]::FromArgb(20, 20, 35)
$txtBox.ForeColor = [System.Drawing.Color]::FromArgb(180, 180, 200)
$txtBox.BorderStyle = "None"
$txtBox.Location = New-Object System.Drawing.Point(20, 475)
$txtBox.Size = New-Object System.Drawing.Size(520, 80)
$txtBox.ReadOnly = $true
$form.Controls.Add($txtBox)

# ---------- 后台监控定时器 ----------
$monitorTimer = New-Object System.Windows.Forms.Timer
$monitorTimer.Interval = 3000
$monitorTimer.Add_Tick({
    try {
        $beRunning = Is-ProcessRunning $script:backendPid
        $tnRunning = Is-ProcessRunning $script:tunnelPid

        # 后端健康检查
        if ($beRunning) {
            try {
                $r = Invoke-WebRequest -Uri "http://localhost:$BackEndPort/api/health" -TimeoutSec 2 -UseBasicParsing
                $form.Invoke([Action]{
                    $lblBEHealth.Text = "健康检查: 正常"
                    $lblBEHealth.ForeColor = [System.Drawing.Color]::LightGreen
                })
            } catch {
                $form.Invoke([Action]{
                    $lblBEHealth.Text = "健康检查: 无响应"
                    $lblBEHealth.ForeColor = [System.Drawing.Color]::Orange
                })
            }
        } else {
            $form.Invoke([Action]{ $lblBEHealth.Text = "" })
        }

        # 隧道日志解析 - 拿到 URL 就显示（不验证可达性）
        if ($tnRunning -and (Test-Path $script:tunnelLogFile) -and -not $script:tunnelUrl) {
            try {
                $fs = [System.IO.FileStream]::new($script:tunnelLogFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                $sr = [System.IO.StreamReader]::new($fs)
                $logContent = $sr.ReadToEnd()
                $sr.Close()
                $fs.Close()
                if ($logContent -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
                    $url = [regex]::Match($logContent, 'https://[a-z0-9\-]+\.trycloudflare\.com').Value
                    if ($url) {
                        $script:tunnelUrl = $url
                        Write-Log "隧道地址: $url"
                        $form.Invoke([Action]{
                            $txtUrl.Text = $url
                            $txtUrl2.Text = $url
                        })
                        if (Is-ProcessRunning $script:backendPid) {
                            Write-Log "重启后端以应用隧道地址到 CORS..."
                            Stop-Backend
                            Start-Backend
                        }
                    }
                }
            } catch {
                Write-Log "读取隧道日志失败: $_"
            }
        }

        # 隧道超时提示
        if ($tnRunning -and -not $script:tunnelUrl -and $script:tunnelStartTime -and -not $script:tunnelTimeoutWarned) {
            $elapsed = (Get-Date) - $script:tunnelStartTime
            if ($elapsed.TotalSeconds -gt 30) {
                Write-Log "隧道启动已超过30秒，仍在等待地址..."
            }
            if ($elapsed.TotalSeconds -gt 60) {
                Write-Log "警告: 隧道启动超时，请检查网络或日志: $script:tunnelLogFile"
                $script:tunnelTimeoutWarned = $true
            }
        }

        # 隧道健康检查（仅状态显示，不阻塞）
        if ($tnRunning -and $script:tunnelUrl) {
            try {
                $r = Invoke-WebRequest -Uri "$($script:tunnelUrl)/api/health" -TimeoutSec 3 -UseBasicParsing
                $form.Invoke([Action]{
                    $lblTNHealth.Text = "健康检查: 正常"
                    $lblTNHealth.ForeColor = [System.Drawing.Color]::LightGreen
                })
            } catch {
                $form.Invoke([Action]{
                    $lblTNHealth.Text = "健康检查: 无响应（DNS 传播中或网络问题）"
                    $lblTNHealth.ForeColor = [System.Drawing.Color]::Orange
                })
            }
        } elseif (-not $tnRunning) {
            $form.Invoke([Action]{ $lblTNHealth.Text = "" })
        }

        Update-Status
    } catch {
        Write-Log "监控异常: $_"
    }
})
$monitorTimer.Start()

# ---------- 窗口显示 ----------
$form.Add_Shown({
    Update-Status
    Write-Log "服务管理器已启动"
    if ($savedPagesDomain) {
        Write-Log "已加载 Pages 域名: $savedPagesDomain"
    } else {
        Write-Log "提示: 请先填写 Cloudflare Pages 域名并保存"
    }
    Write-Log "点击 [全部启动] 开始运行服务"
})

$form.Add_Closing({
    $monitorTimer.Stop()
    Stop-Tunnel
    Stop-Backend
})

[void]$form.ShowDialog()
