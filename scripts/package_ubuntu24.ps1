param(
    [string]$NodeArchive,
    [string]$NodeVersion = '24.14.0'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $NodeArchive) { $NodeArchive = Join-Path $root ("Exports/node-v$NodeVersion-linux-x64.tar.xz") }
if (-not (Test-Path -LiteralPath $NodeArchive -PathType Leaf)) { throw "Missing Node archive: $NodeArchive" }
$name = ('Meow-' + (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version + '-Ubuntu24-x64-') + (Get-Date -Format 'yyyyMMdd-HHmmss')
$out = Join-Path $root ('Exports/' + $name)
$unpack = Join-Path $root ('Exports/.node-linux-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $unpack -Force | Out-Null
    $nodeDirName = "node-v$NodeVersion-linux-x64"
    & tar.exe -xf $NodeArchive -C $unpack "$nodeDirName/bin/node" "$nodeDirName/LICENSE"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to extract Node archive.' }
    $nodeRoot = Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1
    foreach ($dir in @('runtime','pet','src','licenses')) { New-Item -ItemType Directory -Path (Join-Path $out $dir) -Force | Out-Null }
    Copy-Item -LiteralPath (Join-Path $nodeRoot.FullName 'bin/node') -Destination (Join-Path $out 'runtime/node')
    Copy-Item -LiteralPath (Join-Path $nodeRoot.FullName 'LICENSE') -Destination (Join-Path $out 'runtime/LICENSE.txt')
    foreach ($file in @('package.json','pet-settings.example.json','LICENSE','COMMERCIAL-LICENSE.md','Meow')) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $out }
$inventory = & (Get-Command node).Source (Join-Path $PSScriptRoot 'runtimeFiles.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Runtime module inventory failed.' }
foreach ($file in ($inventory | ConvertFrom-Json)) {
    $destination = Join-Path $out $file
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $destination
}
    foreach ($file in @('rewards.json','PAD.md','GROWTH_GUIDE.md')) { Copy-Item -LiteralPath (Join-Path $root ('pet/' + $file)) -Destination (Join-Path $out 'pet') }
    Copy-Item -LiteralPath (Join-Path $root 'pet/dist') -Destination (Join-Path $out 'pet/dist') -Recurse
    Copy-Item -LiteralPath (Join-Path $root 'src/coats.js') -Destination (Join-Path $out 'src')
    foreach ($dep in @('three','cannon-es')) { Copy-Item -LiteralPath (Join-Path $root ('node_modules/' + $dep + '/LICENSE')) -Destination (Join-Path $out ('licenses/' + $dep + '-LICENSE.txt')) }
    Copy-Item -LiteralPath (Join-Path $root 'third_party/mesh2motion/README.md') -Destination (Join-Path $out 'licenses/mesh2motion-README.md')
    @'
Meow — Ubuntu 24.04 x86_64 便携版

1. 解压：tar -xzf Meow-*-Ubuntu24-x64-*.tar.gz
2. 进入解压后的目录：cd Meow-*-Ubuntu24-x64-*
3. 启动：./Meow
4. 停止：在启动终端按 Ctrl+C

无需安装 Node.js、npm 或项目依赖。需要 Ubuntu 24.04 x86_64 标准系统和支持 WebGL 的浏览器。
桌面环境会尝试自动打开浏览器；服务器版请手动打开终端中显示的地址。
本机默认地址：http://localhost:8792/；家长页面：http://localhost:8792/parent.html
如使用 UFW，请按实际需要执行：sudo ufw allow 8792/tcp

配置文件：首次运行按 pet-settings.example.json 生成 pet-settings.json；升级保留现有值。
数据目录：pet/data/
查看状态：./Meow info
备份后清空数据：./Meow reset

本包不包含原有账号、密码、积分、证书或家庭记录。
迁移旧数据时先停止服务，再完整复制旧版 pet/data/ 目录。
许可及原作者署名见 LICENSE、COMMERCIAL-LICENSE.md 和 licenses/。
'@ | Set-Content -LiteralPath (Join-Path $out '使用说明.txt') -Encoding UTF8
    @{ builtAt=(Get-Date -Format o); node=('v' + $NodeVersion); architecture='linux-x64'; target='Ubuntu 24.04'; dataIncluded=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'BUILD.json') -Encoding UTF8
    Write-Output $out
} finally {
    if (Test-Path -LiteralPath $unpack) { Remove-Item -LiteralPath $unpack -Recurse -Force }
}
