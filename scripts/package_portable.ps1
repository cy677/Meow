param([string]$NodePath = (Get-Command node.exe).Source, [string]$NodeLicensePath)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$name = ('Meow-' + (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version + '-Windows-x64-') + (Get-Date -Format 'yyyyMMdd-HHmmss')
$out = Join-Path $root ('Exports/' + $name)
if ((& $NodePath -p '[process.platform,process.arch].join(String.fromCharCode(47))') -ne 'win32/x64') { throw 'Windows x64 Node required.' }
foreach ($dir in @('runtime','scripts','pet','src','licenses')) { New-Item -ItemType Directory -Path (Join-Path $out $dir) -Force | Out-Null }
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $out 'runtime/node.exe')
foreach ($file in @('package.json','pet-settings.example.json','LICENSE','COMMERCIAL-LICENSE.md','一键启动.cmd','清除数据.cmd')) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $out }
Copy-Item -LiteralPath (Join-Path $root 'scripts/pet-launcher.ps1') -Destination (Join-Path $out 'scripts')
$inventory = & $NodePath (Join-Path $PSScriptRoot 'runtimeFiles.mjs')
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
$nodeLicense = if ($NodeLicensePath) { $NodeLicensePath } else { Join-Path (Split-Path $NodePath) 'LICENSE' }
if (-not (Test-Path -LiteralPath $nodeLicense)) { throw 'Missing Node license. Supply -NodeLicensePath for the same runtime version.' }
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $out 'runtime/LICENSE.txt')
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:exe /platform:x64 ("/out:" + (Join-Path $out 'Meow.exe')) (Join-Path $PSScriptRoot 'portable-launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
@'
Meow — Windows 10/11 64位便携版

1. 将整个压缩包解压到可写目录，不要在压缩包中直接运行。
2. 双击 Meow.exe（也可双击 一键启动.cmd）。无需安装 Node.js、npm 或下载依赖。
3. 保留启动窗口。浏览器自动打开家长页面，用窗口中的一次性初始化口令设置账号。
4. 停止服务：在启动窗口按 Ctrl+C。

需要 Windows 自带的 PowerShell、.NET Framework 4.x，以及支持 WebGL 的浏览器（如 Edge）。
首次配置局域网访问时可能出现管理员提示，用于配置 Windows 防火墙。
iPad 与电脑接入同一网络，打开启动窗口中显示的局域网地址。
默认 http://localhost:8792/，家长页面 http://localhost:8792/parent.html。
端口、数据位置等在 pet-settings.json 中修改。

数据保存在 pet/data/。备份、升级或迁移前先停服，再复制整个数据目录。
本包是空数据分发包，不包含原有账号、密码、积分、证书或家庭记录。
若要迁移旧数据，停服后把旧 pet/data/ 完整复制到本包相同位置。
清除数据.cmd 会将现有数据库备份后重置，仅在需要重新开始时使用。

请保留整个文件夹；Meow.exe 不能单独移走。
程序离线运行，电脑作为服务端时需保持开机。
许可及原作者署名见 LICENSE、COMMERCIAL-LICENSE.md 和 licenses 文件夹。
'@ | Set-Content -LiteralPath (Join-Path $out '使用说明.txt') -Encoding UTF8
@{ builtAt=(Get-Date -Format o); node=(& $NodePath --version); architecture='win32-x64'; dataIncluded=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'BUILD.json') -Encoding UTF8
Write-Output $out
