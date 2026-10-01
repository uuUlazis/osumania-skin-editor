param(
  [string]$Version = '0.1.4'
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$target = Join-Path (Join-Path $root 'version') $Version

if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $target | Out-Null

$excludeDirs = @(
  (Join-Path $root 'build'),
  (Join-Path $root 'frontend\node_modules'),
  (Join-Path $root 'version'),
  (Join-Path $root '.git')
)
$excludeFiles = @('build_ops.txt')

$args = @($root, $target, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS')
foreach ($dir in $excludeDirs) {
  $args += '/XD'
  $args += $dir
}
foreach ($file in $excludeFiles) {
  $args += '/XF'
  $args += $file
}

robocopy @args | Out-Host
if ($LASTEXITCODE -ge 8) {
  throw 'robocopy snapshot failed'
}

Write-Output "SNAPSHOT-OK $target"
