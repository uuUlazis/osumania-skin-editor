$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseExe = Join-Path $root 'release\ManiaSkinEditor\ManiaSkinEditor-0.1.4.exe'
$portFile = Join-Path $env:TEMP 'mania_smoke_port.txt'

Remove-Item -LiteralPath $portFile -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath $releaseExe -ArgumentList @('--no-window', '--port', '0', '--port-file', "`"$portFile`"") -PassThru -WindowStyle Hidden
try {
  $deadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Path -LiteralPath $portFile) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
  if (-not (Test-Path -LiteralPath $portFile)) {
    throw 'headless port file missing'
  }
  $port = [int](Get-Content $portFile)
  $base = "http://127.0.0.1:$port"
  $health = curl.exe -s "$base/api/health"
  $index = curl.exe -s "$base/"
  Write-Output "headless.health=$health"
  Write-Output "headless.indexOk=$($index -match 'id=\"root\"')"
  if (-not ($index -match 'id="root"')) {
    throw 'headless index not served'
  }
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
  Remove-Item -LiteralPath $portFile -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $portFile -ErrorAction SilentlyContinue
$gui = Start-Process -FilePath $releaseExe -ArgumentList @('--port-file', "`"$portFile`"") -PassThru
try {
  Start-Sleep -Seconds 6
  $alive = -not $gui.HasExited
  $portReady = Test-Path -LiteralPath $portFile
  Write-Output "gui.alive=$alive gui.portReady=$portReady"
  if (-not $alive) {
    throw 'gui process exited'
  }
} finally {
  if ($gui -and -not $gui.HasExited) {
    Stop-Process -Id $gui.Id -Force
  }
  Remove-Item -LiteralPath $portFile -ErrorAction SilentlyContinue
}

$zipList = tar.exe -tf (Join-Path $root 'release\ManiaSkinEditor-0.1.4-win64.zip')
$zipHasCache = $zipList -match '\.exe\.WebView2'
$zipHasLoader = $zipList -match 'WebView2Loader\.dll'
$zipCount = ($zipList | Measure-Object).Count
Write-Output "zip.entries=$zipCount zip.hasWebView2Cache=$zipHasCache zip.hasLoaderDll=$zipHasLoader"
if ($zipHasCache) {
  throw 'zip still contains WebView2 cache'
}
if ($zipHasLoader) {
  throw 'zip still contains WebView2Loader.dll'
}

Write-Output 'SMOKE-OK'
