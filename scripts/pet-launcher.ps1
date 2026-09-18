param(
    [ValidateSet('start', 'reset', 'firewall', 'info')][string]$Action = 'start',
    [ValidateRange(1, 65535)][int]$Port = 8792,
    [switch]$SkipFirewall,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$operationLock = $null

function Test-MeowFirewall([int]$RulePort) {
    try {
        $rule = Get-NetFirewallRule -Name "MeowPet-TCP-$RulePort" -ErrorAction Stop
        $filter = $rule | Get-NetFirewallPortFilter
        $address = $rule | Get-NetFirewallAddressFilter
        return $rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow' -and $rule.Direction -eq 'Inbound' -and $rule.Profile -eq 'Any' -and $filter.Protocol -eq 'TCP' -and $filter.LocalPort -eq "$RulePort" -and $address.RemoteAddress -eq 'Any'
    } catch { return $false }
}

function Set-MeowFirewall([int]$RulePort) {
    $name = "MeowPet-TCP-$RulePort"
    $existing = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($existing) {
        $existing | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any -RemoteAddress Any
        $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $RulePort
    } else {
        New-NetFirewallRule -Name $name -DisplayName "Meow Pet TCP $RulePort" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $RulePort -RemoteAddress Any -Profile Any | Out-Null
    }
    if (-not (Test-MeowFirewall $RulePort)) { throw '防火墙规则未生效，请检查这台电脑的网络管理策略。' }
    Write-Host "已允许 TCP $RulePort 入站访问。"
}

try {
    # Only this short helper is elevated. The web service runs as the original user.
    if ($Action -eq 'firewall') { Set-MeowFirewall $Port; exit 0 }
    $config = Get-Content -LiteralPath (Join-Path $projectRoot 'pet-settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $portValue = if ($env:MEOW_PORT) { $env:MEOW_PORT } else { $config.port }
    $serverPort = 0
    if (-not [int]::TryParse([string]$portValue, [ref]$serverPort) -or $serverPort -lt 1 -or $serverPort -gt 65535) { throw '端口必须是 1 到 65535 的整数。' }
    $dataSetting = if ($env:MEOW_DATA_DIR) { $env:MEOW_DATA_DIR } else { $config.dataDir }
    if ([string]::IsNullOrWhiteSpace($dataSetting)) { throw '数据目录不能为空。' }
    $dataDir = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($dataSetting)) { $dataSetting } else { Join-Path $projectRoot $dataSetting }))
    $dbPath = Join-Path $dataDir 'pet.sqlite'
    $publicIp = if ($env:MEOW_PUBLIC_IP) { $env:MEOW_PUBLIC_IP.Trim() } else { ([string]$config.publicIp).Trim() }
    if ($Action -eq 'info') {
        [pscustomobject]@{ dataPath=$dbPath; exists=(Test-Path -LiteralPath $dbPath -PathType Leaf); port=$serverPort; publicIp=$publicIp } | ConvertTo-Json -Compress
        exit 0
    }
    Write-Host "数据文件：$dbPath"
    if ($Action -eq 'reset' -and -not (Test-Path -LiteralPath $dataDir)) { Write-Host '没有现有数据库，当前已经是空数据状态。'; exit 0 }
    [IO.Directory]::CreateDirectory($dataDir) | Out-Null
    try { $operationLock = [IO.File]::Open((Join-Path $dataDir '.meow-operation.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw '此数据目录的服务或重置操作正在运行。请先关闭原启动窗口后重试。' }

    if ($Action -eq 'reset') {
        $files = @('pet.sqlite', 'pet.sqlite-wal', 'pet.sqlite-shm', 'pet.sqlite-journal') | ForEach-Object { Join-Path $dataDir $_ } | Where-Object { Test-Path -LiteralPath $_ }
        if (-not $files) { Write-Host '没有现有数据库，当前已经是空数据状态。'; exit 0 }
        $handles = New-Object 'System.Collections.Generic.List[System.IDisposable]'
        $moved = New-Object 'System.Collections.Generic.List[object]'
        $backupDir = Join-Path $dataDir ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        try {
            foreach ($file in $files) {
                $item = Get-Item -LiteralPath $file
                if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "数据库路径不是普通文件：$file" }
                # Deny concurrent readers/writers while allowing our own rename on Windows.
                try { $handle = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Delete) }
                catch { throw '数据库正在使用或无法访问。请先在启动窗口按 Ctrl+C 停服，再运行清除数据。' }
                $handles.Add($handle)
            }
            [IO.Directory]::CreateDirectory($backupDir) | Out-Null
            foreach ($file in $files) {
                $source = [IO.Path]::GetFullPath($file)
                $destination = [IO.Path]::GetFullPath((Join-Path $backupDir ([IO.Path]::GetFileName($source))))
                if ([IO.Path]::GetDirectoryName($source).TrimEnd('\') -ne $dataDir.TrimEnd('\') -or -not $destination.StartsWith($dataDir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '数据路径边界检查失败，未移动文件。' }
                Move-Item -LiteralPath $source -Destination $destination
                $moved.Add([pscustomobject]@{Source=$source;Destination=$destination})
            }
            Write-Host '数据已重置：账号、密码、积分、历史、收藏、装扮和自定义预设将在下次启动时重新初始化。'
            Write-Host "原数据备份：$backupDir"
        } catch {
            $failure = $_
            for ($index=$moved.Count-1; $index -ge 0; $index--) { Move-Item -LiteralPath $moved[$index].Destination -Destination $moved[$index].Source }
            throw $failure
        } finally { foreach ($handle in $handles) { $handle.Dispose() } }
        exit 0
    }

    $bundledNode = Join-Path $projectRoot 'runtime/node.exe'
    $node = if (Test-Path -LiteralPath $bundledNode -PathType Leaf) { [pscustomobject]@{ Source = $bundledNode } } else { Get-Command node.exe -ErrorAction SilentlyContinue }
    if (-not $node) { throw '请先安装 Node.js 22.16 或更高版本，再双击一键启动。' }
    $nodeVersion = [version]((& $node.Source --version).Trim().TrimStart('v'))
    if ($LASTEXITCODE -ne 0 -or $nodeVersion.Major -lt 22 -or ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -lt 16)) { throw 'Node.js 版本过低，需要 22.16 或更高版本。' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'pet/dist/index.html'))) { throw '缺少已构建页面。请先在项目目录执行 npm ci --ignore-scripts 和 npm run pet:build。' }
    $env:MEOW_HOST = '0.0.0.0'
    $env:MEOW_PORT = [string]$serverPort
    $env:MEOW_DATA_DIR = $dataDir
    $env:MEOW_PUBLIC_IP = $publicIp
    # Validate all server options before making any firewall change.
    Push-Location $projectRoot
    try {
        & $node.Source --input-type=module -e "import {launchOptions} from './pet/lan.mjs';launchOptions(['--lan']);"
        if ($LASTEXITCODE -ne 0) { throw '启动配置无效，请检查 pet-settings.json 或 MEOW 环境变量。' }
        if ($config.configureFirewall -and -not $SkipFirewall -and -not (Test-MeowFirewall $serverPort)) {
            Write-Host "首次配置需要允许管理员提示，仅添加网页使用的 TCP $serverPort 防火墙规则。"
            $helperArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-Action', 'firewall', '-Port', "$serverPort")
            $helper = Start-Process -FilePath 'powershell.exe' -ArgumentList $helperArgs -Verb RunAs -WindowStyle Hidden -Wait -PassThru
            if ($helper.ExitCode -ne 0) { throw '防火墙配置失败或被取消。可由管理员配置网页端口后重试。' }
        }
        Write-Host "网页端口：$serverPort；按 Ctrl+C 停止服务。"
        if ($publicIp) { Write-Host "外部访问 IP：$publicIp" }
        Write-Host '请将整个项目目录复制到服务器电脑。路由器/云安全组还需放行同一个网页端口。'
        $serverArgs = @((Join-Path $projectRoot 'pet/server.mjs'), '--lan')
        if ($config.openBrowser -and -not $NoBrowser) { $serverArgs += '--open' }
        & $node.Source @serverArgs
        $serverExit = $LASTEXITCODE
    } finally { Pop-Location }
    exit $serverExit
} catch {
    Write-Host ("操作未完成：" + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally { if ($operationLock) { $operationLock.Dispose() } }
