$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exportsRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'Exports'))
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $exportsRoot 'xhs-minitool'))
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $exportsRoot 'Meow-Generator-XHS-MiniTool.zip'))

if (-not $packageRoot.StartsWith($exportsRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe package path: $packageRoot"
}
if (-not $zipPath.StartsWith($exportsRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe zip path: $zipPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'index.html'))) {
  throw 'index.html is missing from the package root'
}

New-Item -ItemType Directory -Path $exportsRoot -Force | Out-Null
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$outputArchive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Recurse -File -LiteralPath $packageRoot | Sort-Object FullName | ForEach-Object {
    $entryName = ($_.FullName.Substring($packageRoot.Length) -replace '^[\\/]+', '' -replace '\\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $outputArchive,
      $_.FullName,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $outputArchive.Dispose()
}

$allowedExtensions = @('.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json')
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $files = @($archive.Entries | Where-Object { -not [string]::IsNullOrEmpty($_.Name) })
  $rootIndex = @($files | Where-Object { $_.FullName -eq 'index.html' })
  if ($rootIndex.Count -ne 1) {
    throw 'ZIP must contain exactly one index.html at its root'
  }
  if (@($files | Where-Object { $_.FullName -like 'xhs-minitool/*' }).Count -gt 0) {
    throw 'ZIP contains an extra top-level directory'
  }
  if (@($files | Where-Object { $_.FullName.Contains('\\') }).Count -gt 0) {
    throw 'ZIP entries must use forward-slash path separators'
  }
  $unsupported = @($files | Where-Object { $allowedExtensions -notcontains [System.IO.Path]::GetExtension($_.Name).ToLowerInvariant() })
  if ($unsupported.Count -gt 0) {
    throw ('ZIP contains unsupported files: ' + (($unsupported | ForEach-Object FullName) -join ', '))
  }
} finally {
  $archive.Dispose()
}

$zipFile = Get-Item -LiteralPath $zipPath
if ($zipFile.Length -gt 10MB) {
  throw "ZIP exceeds 10MB: $($zipFile.Length) bytes"
}

$result = [ordered]@{
  status = 'pass'
  zipPath = $zipPath
  zipBytes = $zipFile.Length
  sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash
  indexAtRoot = $true
}
$result | ConvertTo-Json
