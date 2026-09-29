$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$files = @(
  'preprocessed_api_server.h',
  'preprocessed_api_server_cpp.txt',
  'probe_compile.txt',
  'probe2.txt',
  'probe3.txt',
  'probe4.txt',
  'probe_permissive.txt'
)
foreach ($name in $files) {
  $path = Join-Path $root $name
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Force
  }
}
Write-Output 'CLEANUP-OK'
