$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$targets = @(
  'build',
  'frontend\node_modules',
  'backend_cfg.txt',
  'backend_v012.txt',
  'backend_v012b.txt'
)

foreach ($name in $targets) {
  $path = Join-Path $root $name
  if (-not (Test-Path -LiteralPath $path)) {
    continue
  }
  $resolved = (Resolve-Path -LiteralPath $path).Path
  if (-not $resolved.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar)) {
    throw "refusing to remove path outside snapshot: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
  Write-Output "removed=$resolved"
}

Write-Output 'ARCHIVE-CLEAN-OK'
