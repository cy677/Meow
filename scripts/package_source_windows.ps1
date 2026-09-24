param(
    [string]$Name = ('Meow-v6-source-Windows-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
    [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
    [string]$NodeLicensePath = ''
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exports = Join-Path $root 'Exports'
if ($Name -notmatch '^[A-Za-z0-9_.-]+$' -or $Name -in @('.', '..')) { throw '输出名称无效。' }
$stage = Join-Path $exports $Name
$archive = "$stage.zip"
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $archive)) { throw '同名输出已存在，请换一个名称。' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'pet/dist/index.html'))) { throw '缺少已构建页面，请先执行 npm run pet:build。' }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw '缺少 Windows Node.js 运行程序。' }
if (-not $NodeLicensePath) { $NodeLicensePath = Join-Path $exports 'node-v24.14.0-LICENSE.txt' }
if (-not (Test-Path -LiteralPath $NodeLicensePath -PathType Leaf)) { throw '缺少对应 Node.js 版本的许可证文件。' }
$nodeVersion = (& $NodePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v24.14.0') { throw '本包使用 Node.js v24.14.0，请提供匹配的运行程序及许可证。' }

function Copy-Relative([string]$relative, [string]$destination = $relative) {
    $source = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "缺少源文件：$relative" }
    $target = Join-Path $stage $destination
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
}

function Copy-Tree([string]$folder, [string[]]$extensions, [string[]]$excludedTop = @()) {
    $sourceRoot = Join-Path $root $folder
    $prefix = $sourceRoot.TrimEnd('\') + '\'
    foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -Force -File) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "不打包链接：$($file.FullName)" }
        if (-not $file.FullName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw '源文件越界。' }
        $within = $file.FullName.Substring($prefix.Length)
        $top = $within.Split([char]'\')[0]
        if ($top -in $excludedTop -or $file.Extension.ToLowerInvariant() -notin $extensions) { continue }
        Copy-Relative (Join-Path $folder $within)
    }
}

foreach ($file in @('package.json', 'package-lock.json', 'index.html', 'vite.config.js',
        'pet-settings.example.json', 'LICENSE', 'COMMERCIAL-LICENSE.md', '一键启动.cmd')) {
    Copy-Relative $file
}
Copy-Relative 'scripts/pet-launcher.ps1'
Copy-Tree 'src' @('.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.mp3', '.glb')
Copy-Tree 'pet' @('.js', '.mjs', '.css', '.html', '.json') @('tests', 'test-results', 'data', 'dist')
Copy-Tree 'public' @('.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.glb', '.mp3', '.ogg', '.woff2', '.ico')
Copy-Tree 'pet/dist' @('.js', '.css', '.html', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.glb', '.mp3', '.ogg', '.woff2', '.ico')
Copy-Relative 'node_modules/three/LICENSE' 'licenses/three-LICENSE.txt'
Copy-Relative 'node_modules/cannon-es/LICENSE' 'licenses/cannon-es-LICENSE.txt'
Copy-Relative 'third_party/mesh2motion/README.md' 'licenses/mesh2motion-NOTICE.md'
foreach ($pack in @('toy-car-kit', 'cube-pets', 'brick-kit', 'furniture-kit')) {
    Copy-Relative "third_party/kenney/$pack/License.txt" "licenses/kenney-$pack-LICENSE.txt"
}
[IO.Directory]::CreateDirectory((Join-Path $stage 'runtime')) | Out-Null
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $stage 'runtime/node.exe')
Copy-Item -LiteralPath $NodeLicensePath -Destination (Join-Path $stage 'runtime/LICENSE.txt')

# Keep the install and build commands usable while omitting test and unrelated
# mini-tool commands from the distribution's package metadata.
$packagePath = Join-Path $stage 'package.json'
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$package.scripts = [ordered]@{
    build = 'vite build'
    'pet:build' = 'vite build --config pet/vite.config.mjs'
    'pet:start' = 'node pet/server.mjs'
    'pet:lan' = 'node pet/server.mjs --lan'
    'pet:lan:https' = 'node pet/server.mjs --lan --https'
    'pet:dev' = 'node pet/server.mjs --dev'
}
[IO.File]::WriteAllText($packagePath, ($package | ConvertTo-Json -Depth 20) + "`n", [Text.UTF8Encoding]::new($false))

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive, [IO.Compression.CompressionLevel]::Optimal, $true)
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $names = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    if (-not ($names -contains "$Name/一键启动.cmd") -or -not ($names -contains "$Name/pet/dist/index.html")) { throw '压缩包缺少启动入口。' }
    foreach ($entry in $names) {
        if ($entry -match '(^|/)(tests|test-results|data|docs|output|node_modules)/' -or
            $entry -match '(^|/)pet-settings\.json$' -or
            $entry -match '\.sqlite($|[-.])' -or
            ($entry -match '\.md$' -and $entry -notmatch '(^|/)(COMMERCIAL-LICENSE|mesh2motion-NOTICE)\.md$')) {
            throw "压缩包包含无关或私有文件：$entry"
        }
    }
    Write-Output ([pscustomobject]@{ Archive = $archive; Stage = $stage; Files = $names.Count; Node = $nodeVersion })
} finally { $zip.Dispose() }
