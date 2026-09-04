$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseDir = Join-Path $root 'release\ManiaSkinEditor'
$zipPath = Join-Path $root 'release\ManiaSkinEditor-0.1.2-win64.zip'
$currentExe = 'ManiaSkinEditor-0.1.2.exe'

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
foreach ($cacheName in @('ManiaSkinEditor.exe.WebView2', 'ManiaSkinEditor-0.1.1.exe.WebView2', "$currentExe.WebView2")) {
  $webviewData = Join-Path $releaseDir $cacheName
  if (Test-Path -LiteralPath $webviewData) {
    Remove-Item -LiteralPath $webviewData -Recurse -Force
  }
}
$loaderDll = Join-Path $releaseDir 'WebView2Loader.dll'
if (Test-Path -LiteralPath $loaderDll) {
  Remove-Item -LiteralPath $loaderDll -Force
}
$legacyExe = Join-Path $releaseDir 'ManiaSkinEditor.exe'
if (Test-Path -LiteralPath $legacyExe) {
  Remove-Item -LiteralPath $legacyExe -Force
}
$oldExe = Join-Path $releaseDir 'ManiaSkinEditor-0.1.1.exe'
if (Test-Path -LiteralPath $oldExe) {
  Remove-Item -LiteralPath $oldExe -Force
}
Copy-Item -LiteralPath (Join-Path $root "build\$currentExe") -Destination (Join-Path $releaseDir $currentExe) -Force

$logs = Get-ChildItem $root -File | Where-Object {
  $_.Name -like 'build_log*.txt' -or
  $_.Name -eq 'ctest_log.txt' -or
  $_.Name -eq 'build_final.txt' -or
  $_.Name -eq 'build_rev2.txt' -or
  $_.Name -eq 'build_embed.txt'
}
foreach ($log in $logs) {
  Remove-Item -LiteralPath $log.FullName -Force
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path $releaseDir -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output 'PACKAGE-OK'
Get-ChildItem $releaseDir | Select-Object Name, Length
Get-Item $zipPath | Select-Object Name, Length
