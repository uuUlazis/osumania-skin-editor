$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

$vcvars = '"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"'
$cmake = '"C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"'
$ctest = '"C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe"'

Write-Host '[1/4] frontend build'
Push-Location (Join-Path $root 'frontend')
if (-not (Test-Path 'node_modules')) {
  npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
Pop-Location

Write-Host '[2/4] backend build'
cmd /c "$vcvars && $cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release"
if ($LASTEXITCODE -ne 0) { throw 'cmake configure failed' }
(Get-Item (Join-Path $root 'backend\src\http\api_server.cpp')).LastWriteTime = Get-Date
cmd /c "$vcvars && $cmake --build build"
if ($LASTEXITCODE -ne 0) { throw 'backend build failed' }

Write-Host '[3/4] tests'
cmd /c "$vcvars && $ctest --test-dir build --output-on-failure"
if ($LASTEXITCODE -ne 0) { throw 'ctest failed' }
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\integration_test.ps1')
if ($LASTEXITCODE -ne 0) { throw 'integration test failed' }

Write-Host '[4/4] package'
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\package.ps1')
if ($LASTEXITCODE -ne 0) { throw 'package failed' }

Write-Host 'BUILD-OK'
