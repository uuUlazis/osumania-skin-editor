$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$exe = Join-Path $root 'build\ManiaSkinEditor-0.1.4.exe'
$portFile = Join-Path $env:TEMP 'mania_port.txt'
$testSkin = Join-Path $env:TEMP 'mania_skin_editor_test_skin'
$outerRoot = (Resolve-Path (Join-Path (Join-Path $root '..') '..')).Path
$outerSourceSkin = Join-Path $outerRoot 'test\Skins\R Skin v3.1 (LN changed)'
$localSourceSkin = Join-Path $root 'test\Skins\R Skin v3.1 (LN changed)'
$sourceSkin = if (Test-Path -LiteralPath $outerSourceSkin) {
  $outerSourceSkin
} else {
  $localSourceSkin
}
$clonedPath = $null
$profilePath = Join-Path $env:TEMP 'skin.styles.json'
$python = 'C:\Users\19677\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'

Remove-Item -LiteralPath $portFile -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $testSkin) {
  Remove-Item -LiteralPath $testSkin -Recurse -Force
}
Copy-Item -LiteralPath $sourceSkin -Destination $testSkin -Recurse -Force

$proc = Start-Process -FilePath $exe -ArgumentList @('--no-window', '--port', '0', '--port-file', "`"$portFile`"") -PassThru -WindowStyle Hidden

try {
  $deadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Path -LiteralPath $portFile) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
  if (-not (Test-Path -LiteralPath $portFile)) {
    throw 'port file not created'
  }

  $port = [int](Get-Content $portFile)
  $base = "http://127.0.0.1:$port"
  Write-Output "PORT=$port"

  $html = curl.exe -s "$base/"
  $indexOk = $html -match 'id="root"' -and $html -match '/assets/'
  Write-Output "index.lines=$($html.Count) indexOk=$indexOk"
  if (-not $indexOk) {
    throw 'embedded index.html not served'
  }

  $schema = Invoke-RestMethod "$base/api/schema"
  Write-Output "schemaFields=$($schema.fields.Count)"
  $commonFields = @($schema.fields | Where-Object { $_.group -eq 'common' })
  Write-Output "commonFields=$($commonFields.Count)"
  if ($commonFields.Count -ne 6) {
    throw 'common field module should contain 6 fields'
  }

  $openTemp = Invoke-RestMethod -Method Post -Uri "$base/api/skin-dir/open" -ContentType 'application/json' -Body (@{ path = $env:TEMP } | ConvertTo-Json)
  $history = Invoke-RestMethod "$base/api/history"
  $historyHasTemp = @($history.entries | Where-Object { $_.path -eq $env:TEMP }).Count -gt 0
  Write-Output "history.hasTemp=$historyHasTemp"
  if (-not $historyHasTemp) {
    throw 'history did not record opened directory'
  }
  $removeHistoryBody = @{ path = $env:TEMP } | ConvertTo-Json
  $historyRemoved = Invoke-RestMethod -Method Post -Uri "$base/api/history/remove" -ContentType 'application/json' -Body $removeHistoryBody
  $historyGone = @($historyRemoved.entries | Where-Object { $_.path -eq $env:TEMP }).Count -eq 0
  Write-Output "history.removeOk=$historyGone"
  if (-not $historyGone) {
    throw 'history remove failed'
  }

  $data = Invoke-RestMethod "$base/api/skin?path=$([uri]::EscapeDataString($testSkin))"
  Write-Output "blocks=$($data.blocks.Count) has4k=$($data.blocks.keys -contains 4)"
  if (-not ($data.blocks.keys -contains 4)) {
    throw '4K block missing'
  }

  $testPng = Join-Path $testSkin 'generated_test.png'
  & $python (Join-Path $root 'scripts\generate_test_png.py') $testPng
  $pngInfo = Invoke-RestMethod "$base/api/skin/image/info?path=$([uri]::EscapeDataString($testSkin))&name=generated_test.png"
  $m = $pngInfo.metrics
  Write-Output "png.info top=$($m.topSpacing) left=$($m.leftSpacing) right=$($m.rightSpacing) bottom=$($m.bottomSpacing) maxAlpha=$($m.maxAlpha)"
  if ($m.topSpacing -ne 3 -or $m.leftSpacing -ne 4 -or $m.rightSpacing -ne 5 -or $m.bottomSpacing -ne 6 -or $m.maxAlpha -ne 200) {
    throw 'png recognition metrics mismatch'
  }

  $editBody = @{ path = $testSkin; name = 'generated_test.png'; targetName = 'generated_edit.png'; top = 1; left = 2; right = 3; alphaScalePercent = 50; alphaValue = -1 } | ConvertTo-Json
  $editResult = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/edit" -ContentType 'application/json' -Body $editBody
  $em = $editResult.metrics
  Write-Output "png.edit size=$($em.width)x$($em.height) top=$($em.topSpacing) maxAlpha=$($em.maxAlpha)"
  if ($em.width -ne 20 -or $em.height -ne 18 -or $em.topSpacing -ne 1 -or $em.leftSpacing -ne 2 -or $em.maxAlpha -ne 100) {
    throw 'png edit metrics mismatch'
  }

  $alphaFixedBody = @{ path = $testSkin; name = 'generated_edit.png'; targetName = 'alpha_fixed_test.png'; top = -1; left = -1; right = -1; alphaScalePercent = 100; alphaValue = 128 } | ConvertTo-Json
  $alphaFixed = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/edit" -ContentType 'application/json' -Body $alphaFixedBody
  $afm = $alphaFixed.metrics
  Write-Output "png.alphaFixed maxAlpha=$($afm.maxAlpha) transparent=$($afm.fullyTransparentCount) sourceTransparent=$($em.fullyTransparentCount)"
  if ($afm.maxAlpha -ne 128 -or $afm.fullyTransparentCount -ne $em.fullyTransparentCount -or $afm.fullyTransparentCount -eq 0) {
    throw 'fixed alpha should change visible pixels only and preserve transparent pixels'
  }

  $overwriteBody = @{ path = $testSkin; name = 'generated_test.png'; targetName = 'generated_test.png'; top = 0; left = 0; right = 0; alphaValue = 255; alphaScalePercent = 100 } | ConvertTo-Json
  $overwriteResult = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/edit" -ContentType 'application/json' -Body $overwriteBody
  $om = $overwriteResult.metrics
  $backupOk = Test-Path -LiteralPath (Join-Path $testSkin 'generated_test.png.bak')
  Write-Output "png.overwrite size=$($om.width)x$($om.height) backup=$backupOk"
  if ($om.width -ne 15 -or $om.height -ne 17 -or $om.maxAlpha -ne 255 -or -not $backupOk) {
    throw 'png overwrite or backup failed'
  }

  $previewBody = @{ path = $testSkin; name = 'generated_test.png'; top = 1; left = 2; right = 3; alphaScalePercent = 50; alphaValue = -1 } | ConvertTo-Json
  $previewHeadersFile = Join-Path $env:TEMP 'mania_preview_headers.txt'
  $previewFile = Join-Path $env:TEMP 'mania_preview.png'
  $previewBodyFile = Join-Path $env:TEMP 'mania_preview_body.json'
  Remove-Item -LiteralPath $previewHeadersFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $previewFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $previewBodyFile -ErrorAction SilentlyContinue
  [System.IO.File]::WriteAllText($previewBodyFile, $previewBody, [System.Text.Encoding]::UTF8)
  curl.exe -s -D $previewHeadersFile -o $previewFile -X POST -H "Content-Type: application/json" --data "@$previewBodyFile" "$base/api/skin/image/preview" | Out-Null
  $previewBytes = [System.IO.File]::ReadAllBytes($previewFile)
  $previewHeaderLines = Get-Content -LiteralPath $previewHeadersFile
  $previewWidthLine = @($previewHeaderLines | Where-Object { $_ -like 'X-Preview-Width:*' })[0]
  $previewHeightLine = @($previewHeaderLines | Where-Object { $_ -like 'X-Preview-Height:*' })[0]
  $previewWidth = [int]([string]$previewWidthLine -replace '^X-Preview-Width:\s*', '')
  $previewHeight = [int]([string]$previewHeightLine -replace '^X-Preview-Height:\s*', '')
  $pngOk = $previewBytes.Length -gt 8 -and $previewBytes[0] -eq 137 -and $previewBytes[1] -eq 80 -and $previewBytes[2] -eq 78 -and $previewBytes[3] -eq 71
  Write-Output "png.preview png=$pngOk size=${previewWidth}x${previewHeight} bytes=$($previewBytes.Length)"
  if (-not $pngOk) {
    Write-Output ('png.preview.response=' + [System.Text.Encoding]::UTF8.GetString($previewBytes))
  }
  Remove-Item -LiteralPath $previewHeadersFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $previewFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $previewBodyFile -ErrorAction SilentlyContinue
  if (-not $pngOk -or $previewWidth -ne 20 -or $previewHeight -ne 18) {
    throw 'png preview endpoint failed'
  }

  $tallPng = Join-Path $testSkin 'tall_test.png'
  & $python (Join-Path $root 'scripts\generate_tall_test_png.py') $tallPng
  $tallInfo = Invoke-RestMethod "$base/api/skin/image/info?path=$([uri]::EscapeDataString($testSkin))&name=tall_test.png"
  $tm = $tallInfo.metrics
  Write-Output "png.tall size=$($tm.width)x$($tm.height) top=$($tm.topSpacing) left=$($tm.leftSpacing) right=$($tm.rightSpacing)"
  if ($tm.width -ne 10 -or $tm.height -ne 80000 -or $tm.topSpacing -ne 5 -or $tm.leftSpacing -ne 2 -or $tm.rightSpacing -ne 2) {
    throw 'tall png recognition failed'
  }

  $tallEditBody = @{ path = $testSkin; name = 'tall_test.png'; targetName = 'tall_edit.png'; top = 0; left = 0; right = 0; alphaValue = -1; alphaScalePercent = 100 } | ConvertTo-Json
  $tallEdit = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/edit" -ContentType 'application/json' -Body $tallEditBody
  $tem = $tallEdit.metrics
  Write-Output "png.tall.edit size=$($tem.width)x$($tem.height)"
  if ($tem.width -ne 6 -or $tem.height -ne 79995) {
    throw 'tall png edit failed'
  }

  $localStartBody = @{ path = $testSkin; name = 'generated_test.png' } | ConvertTo-Json
  $localStart = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/start" -ContentType 'application/json' -Body $localStartBody
  $workId = $localStart.workId
  Write-Output "local.workId=$($workId.Length -gt 0) metrics=$($localStart.metrics.width)x$($localStart.metrics.height) canUndo=$($localStart.canUndo) canRedo=$($localStart.canRedo)"
  if (-not $workId -or $localStart.metrics.width -ne 15 -or $localStart.metrics.height -ne 17) {
    throw 'local session start failed'
  }
  if ($localStart.canUndo -ne $false -or $localStart.canRedo -ne $false) {
    throw 'new local session should not allow undo or redo'
  }

  $workImage = curl.exe -s "$base/api/skin/image/working?workId=$workId" -o (Join-Path $env:TEMP 'local_work.png') -w '%{http_code}'
  $workBytes = [System.IO.File]::ReadAllBytes((Join-Path $env:TEMP 'local_work.png'))
  $workPng = $workBytes.Length -gt 8 -and $workBytes[0] -eq 137 -and $workBytes[1] -eq 80
  Remove-Item -LiteralPath (Join-Path $env:TEMP 'local_work.png') -ErrorAction SilentlyContinue
  Write-Output "local.workPng=$workPng http=$workImage"
  if (-not $workPng) {
    throw 'working image endpoint failed'
  }

  $transformBody = @{ workId = $workId; sourceX0 = 0; sourceY0 = 0; sourceX1 = 14; sourceY1 = 10; targetX0 = 0; targetY0 = 0; targetX1 = 14; targetY1 = 11 } | ConvertTo-Json
  $transformed = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/transform" -ContentType 'application/json' -Body $transformBody
  Write-Output "local.transform=$($transformed.ok) size=$($transformed.metrics.width)x$($transformed.metrics.height) canUndo=$($transformed.canUndo) canRedo=$($transformed.canRedo)"
  if (-not $transformed.ok) {
    throw 'local transform failed'
  }
  if ($transformed.canUndo -ne $true -or $transformed.canRedo -ne $false) {
    throw 'transformed session should allow undo but not redo'
  }

  $undoBody = @{ workId = $workId } | ConvertTo-Json
  $localUndo = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/undo" -ContentType 'application/json' -Body $undoBody
  $localRedo = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/redo" -ContentType 'application/json' -Body $undoBody
  Write-Output "local.undo=$($localUndo.ok) canUndo=$($localUndo.canUndo) canRedo=$($localUndo.canRedo) redo=$($localRedo.ok) canUndo=$($localRedo.canUndo) canRedo=$($localRedo.canRedo)"
  if (-not $localUndo.ok -or -not $localRedo.ok) {
    throw 'local undo/redo failed'
  }
  if ($localUndo.canUndo -ne $false -or $localUndo.canRedo -ne $true) {
    throw 'undo to initial state should disable undo and enable redo'
  }
  if ($localRedo.canUndo -ne $true -or $localRedo.canRedo -ne $false) {
    throw 'redo to latest state should enable undo and disable redo'
  }

  $preBorder = $localRedo.metrics

  $lineProfile = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/profile" -ContentType 'application/json' -Body $undoBody
  Write-Output "local.profile ok=$($lineProfile.ok) size=$($lineProfile.width)x$($lineProfile.height) hasContent=$($lineProfile.hasContent) bbox=$($lineProfile.content.minX),$($lineProfile.content.minY),$($lineProfile.content.maxX),$($lineProfile.content.maxY) edges=$($lineProfile.edges.left.Count),$($lineProfile.edges.right.Count),$($lineProfile.edges.top.Count),$($lineProfile.edges.bottom.Count)"
  if (-not $lineProfile.ok) {
    throw 'local profile failed'
  }
  if ($lineProfile.width -ne $preBorder.width -or $lineProfile.height -ne $preBorder.height) {
    throw 'local profile size does not match the work image'
  }
  if (-not $lineProfile.hasContent) {
    throw 'local profile should report content'
  }
  if ($lineProfile.content.minX -lt 0 -or $lineProfile.content.maxX -ge $lineProfile.width -or $lineProfile.content.minY -lt 0 -or $lineProfile.content.maxY -ge $lineProfile.height) {
    throw 'local profile bounding box out of range'
  }
  $bottomLineBody = @{ workId = $workId; side = 'bottom'; position = ($lineProfile.height - 1); width = 3; r = 0; g = 0; b = 255; a = 255 } | ConvertTo-Json
  $bottomLine = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/border-line" -ContentType 'application/json' -Body $bottomLineBody
  Write-Output "local.borderLine side=bottom bottom=$($bottomLine.metrics.bottomSpacing) top=$($bottomLine.metrics.topSpacing) canUndo=$($bottomLine.canUndo) canRedo=$($bottomLine.canRedo)"
  if (-not $bottomLine.ok -or $bottomLine.metrics.bottomSpacing -ne 0 -or $bottomLine.canUndo -ne $true -or $bottomLine.canRedo -ne $false) {
    throw 'single border line draw failed'
  }
  $lineUndo = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/undo" -ContentType 'application/json' -Body $undoBody
  Write-Output "local.borderLine.undo bottom=$($lineUndo.metrics.bottomSpacing) expect=$($preBorder.bottomSpacing) canRedo=$($lineUndo.canRedo)"
  if ($lineUndo.metrics.bottomSpacing -ne $preBorder.bottomSpacing -or $lineUndo.canRedo -ne $true) {
    throw 'border line undo did not restore the previous image'
  }
  $lineRedo = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/redo" -ContentType 'application/json' -Body $undoBody
  if ($lineRedo.metrics.bottomSpacing -ne 0 -or $lineRedo.canUndo -ne $true) {
    throw 'border line redo did not restore the line'
  }
  Write-Output 'local.borderLine.undoRedo=True'
  $lineBadSideRejected = $false
  try {
    $lineBadSideBody = @{ workId = $workId; side = 'middle'; position = 0; width = 2; r = 0; g = 0; b = 0; a = 255 } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/border-line" -ContentType 'application/json' -Body $lineBadSideBody | Out-Null
  } catch {
    $lineBadSideRejected = $true
  }
  $lineBadPosRejected = $false
  try {
    $lineBadPosBody = @{ workId = $workId; side = 'bottom'; position = ($lineProfile.height + 4); width = 2; r = 0; g = 0; b = 0; a = 255 } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/border-line" -ContentType 'application/json' -Body $lineBadPosBody | Out-Null
  } catch {
    $lineBadPosRejected = $true
  }
  Write-Output "local.borderLine.reject badSide=$lineBadSideRejected badPosition=$lineBadPosRejected"
  if (-not $lineBadSideRejected -or -not $lineBadPosRejected) {
    throw 'invalid border line requests should be rejected'
  }
  $saveWorkBody = @{ workId = $workId; path = $testSkin; name = 'generated_test.png'; targetName = 'local_saved.png'; top = 0; left = 0; right = 0; alphaValue = 255; alphaScalePercent = 100 } | ConvertTo-Json
  $savedWork = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/save-working" -ContentType 'application/json' -Body $saveWorkBody
  $savedExists = Test-Path -LiteralPath (Join-Path $testSkin 'local_saved.png')
  Write-Output "local.save=$($savedWork.ok) exists=$savedExists"
  if (-not $savedWork.ok -or -not $savedExists) {
    throw 'save working failed'
  }

  $blockPng = Join-Path $testSkin 'transform_block_test.png'
  & $python (Join-Path $root 'scripts\generate_transform_test_png.py') $blockPng
  $blockStartBody = @{ path = $testSkin; name = 'transform_block_test.png' } | ConvertTo-Json
  $blockStart = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/start" -ContentType 'application/json' -Body $blockStartBody
  $blockId = $blockStart.workId
  $moveBody = @{ workId = $blockId; sourceX0 = 1; sourceY0 = 1; sourceX1 = 3; sourceY1 = 3; targetX0 = 8; targetY0 = 8; targetX1 = 10; targetY1 = 10 } | ConvertTo-Json
  $blockMoved = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/transform" -ContentType 'application/json' -Body $moveBody
  $bm = $blockMoved.metrics
  Write-Output "local.move left=$($bm.leftSpacing) top=$($bm.topSpacing) transparent=$($bm.fullyTransparentCount)"
  if ($bm.leftSpacing -ne 8 -or $bm.topSpacing -ne 8 -or $bm.fullyTransparentCount -ne 247) {
    throw 'local transform did not clear the original source area'
  }
  $undoBody = @{ workId = $blockId } | ConvertTo-Json
  $blockUndo = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/undo" -ContentType 'application/json' -Body $undoBody
  $blockRedo = Invoke-RestMethod -Method Post -Uri "$base/api/skin/image/local/redo" -ContentType 'application/json' -Body $undoBody
  if ($blockUndo.metrics.leftSpacing -ne 1 -or $blockRedo.metrics.leftSpacing -ne 8) {
    throw 'local undo/redo did not preserve move semantics'
  }
  Write-Output 'local.move.undoRedo=True'

  $updates = @(
    @{ key = 'HitPosition'; value = '500' },
    @{ key = 'ColumnWidth'; value = '50,50,50,50' },
    @{ key = 'NoteImage0'; value = 'custom-note' }
  )
  $body = @{ path = $testSkin; keys = 4; updates = $updates } | ConvertTo-Json -Depth 6
  $save = Invoke-RestMethod -Method Put -Uri "$base/api/skin/mania" -ContentType 'application/json' -Body $body
  Write-Output "save.ok=$($save.ok) version=$($save.version)"
  if (-not $save.ok) {
    throw 'save failed'
  }

  $after = Invoke-RestMethod "$base/api/skin?path=$([uri]::EscapeDataString($testSkin))"
  $block4 = $after.blocks | Where-Object { $_.keys -eq 4 } | Select-Object -First 1
  Write-Output "4k.HitPosition=$($block4.values.HitPosition) 4k.NoteImage0=$($block4.values.NoteImage0)"
  if ($block4.values.HitPosition -ne '500' -or $block4.values.NoteImage0 -ne 'custom-note') {
    throw 'saved values not reflected'
  }

  $commentOk = $after.raw -match '//'
  $generalOk = $after.raw -match '\[General\]'
  $hitOk = $after.raw -match 'HitPosition: 500'
  Write-Output "raw.comment=$commentOk raw.general=$generalOk raw.hit500=$hitOk"
  if (-not ($commentOk -and $generalOk -and $hitOk)) {
    throw 'raw ini content broken'
  }

  $backupOk = Test-Path -LiteralPath (Join-Path $testSkin 'skin.ini.bak')
  $tmpGone = -not (Test-Path -LiteralPath (Join-Path $testSkin 'skin.ini.tmp'))
  Write-Output "backup=$backupOk tmpGone=$tmpGone"
  if (-not ($backupOk -and $tmpGone)) {
    throw 'backup or atomic write check failed'
  }

  if (Test-Path -LiteralPath $profilePath) {
    throw 'profile should not exist before first style save'
  }
  $styleValues = @{ HitPosition = '500'; ColumnWidth = '50,50,50,50' }
  $styleBody = @{ path = $testSkin; keys = 4; name = 'Style A'; values = $styleValues } | ConvertTo-Json -Depth 6
  $styleSave = Invoke-RestMethod -Method Post -Uri "$base/api/skin/styles/save" -ContentType 'application/json' -Body $styleBody
  $styleNames = @($styleSave.styles.'4' | ForEach-Object { $_.name })
  $profileCreated = Test-Path -LiteralPath $profilePath
  Write-Output "style.saveOk=$($styleNames -contains 'Style A') profileCreated=$profileCreated"
  if ($styleNames -notcontains 'Style A' -or -not $profileCreated) {
    throw 'style save failed'
  }

  $renameBody = @{ path = $testSkin; keys = 4; oldName = 'Style A'; newName = 'Style B' } | ConvertTo-Json
  $styleRename = Invoke-RestMethod -Method Post -Uri "$base/api/skin/styles/rename" -ContentType 'application/json' -Body $renameBody
  $renameNames = @($styleRename.styles.'4' | ForEach-Object { $_.name })
  if ($renameNames -notcontains 'Style B' -or $renameNames -contains 'Style A') {
    throw 'style rename failed'
  }

  $deleteBody = @{ path = $testSkin; keys = 4; name = 'Style B' } | ConvertTo-Json
  $styleDelete = Invoke-RestMethod -Method Post -Uri "$base/api/skin/styles/delete" -ContentType 'application/json' -Body $deleteBody
  if (@($styleDelete.styles.'4').Count -ne 0) {
    throw 'style delete failed'
  }
  Write-Output 'styles: save->rename->delete OK'

  $styleCBody = @{ path = $testSkin; keys = 4; name = 'Style C'; values = @{ HitPosition = '500' } } | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Method Post -Uri "$base/api/skin/styles/save" -ContentType 'application/json' -Body $styleCBody | Out-Null

  $cloneBody = @{ path = $testSkin } | ConvertTo-Json
  $clone = Invoke-RestMethod -Method Post -Uri "$base/api/skin/clone" -ContentType 'application/json' -Body $cloneBody
  $clonedPath = $clone.path
  $cloneOk = $clone.ok -and (Test-Path -LiteralPath $clonedPath)
  Write-Output "clone.name=$($clone.name) cloneOk=$cloneOk"
  if (-not $cloneOk) {
    throw 'clone failed'
  }
  $profileDoc = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json
  $cloneStyles = @($profileDoc.skins.$($clone.name).'4' | ForEach-Object { $_.name })
  if ($cloneStyles -notcontains 'Style C') {
    throw 'clone did not copy styles'
  }

  $opsState = Invoke-RestMethod "$base/api/skin/ops"
  if (-not $opsState.canUndo) {
    throw 'undo should be available after clone'
  }

  $renameBody = @{ path = $clonedPath; newName = 'renamed skin' } | ConvertTo-Json
  $rename = Invoke-RestMethod -Method Post -Uri "$base/api/skin/rename" -ContentType 'application/json' -Body $renameBody
  $renamedPath = $rename.path
  if (-not (Test-Path -LiteralPath $renamedPath) -or (Test-Path -LiteralPath $clonedPath)) {
    throw 'rename failed'
  }
  $profileDoc = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json
  $renamedStyles = @($profileDoc.skins.'renamed skin'.'4' | ForEach-Object { $_.name })
  if ($renamedStyles -notcontains 'Style C' -or $null -ne $profileDoc.skins.$($clone.name)) {
    throw 'rename did not move styles'
  }

  Invoke-RestMethod -Method Post -Uri "$base/api/skin/undo" -ContentType 'application/json' | Out-Null
  if (-not (Test-Path -LiteralPath $clonedPath) -or (Test-Path -LiteralPath $renamedPath)) {
    throw 'undo rename failed'
  }
  $profileDoc = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json
  if ($null -eq $profileDoc.skins.$($clone.name) -or $null -ne $profileDoc.skins.'renamed skin') {
    throw 'undo rename did not move styles back'
  }

  Invoke-RestMethod -Method Post -Uri "$base/api/skin/redo" -ContentType 'application/json' | Out-Null
  if (-not (Test-Path -LiteralPath $renamedPath) -or (Test-Path -LiteralPath $clonedPath)) {
    throw 'redo rename failed'
  }
  $profileDoc = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json
  if ($null -eq $profileDoc.skins.'renamed skin' -or $null -ne $profileDoc.skins.$($clone.name)) {
    throw 'redo rename did not move styles'
  }

  $deleteBody = @{ path = $renamedPath } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$base/api/skin/delete" -ContentType 'application/json' -Body $deleteBody | Out-Null
  if (Test-Path -LiteralPath $renamedPath) {
    throw 'delete failed'
  }
  $profileDoc = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json
  if ($null -ne $profileDoc.skins.'renamed skin') {
    throw 'delete did not remove styles'
  }

  Invoke-RestMethod -Method Post -Uri "$base/api/skin/undo" -ContentType 'application/json' | Out-Null
  if (-not (Test-Path -LiteralPath $renamedPath)) {
    throw 'undo delete failed'
  }
  $profileDoc = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json
  $restoredStyles = @($profileDoc.skins.'renamed skin'.'4' | ForEach-Object { $_.name })
  if ($restoredStyles -notcontains 'Style C') {
    throw 'undo delete did not restore styles'
  }

  Invoke-RestMethod -Method Post -Uri "$base/api/skin/redo" -ContentType 'application/json' | Out-Null
  if (Test-Path -LiteralPath $renamedPath) {
    throw 'redo delete failed'
  }
  $profileDoc = Get-Content -Raw -LiteralPath $profilePath | ConvertFrom-Json
  if ($null -ne $profileDoc.skins.'renamed skin') {
    throw 'redo delete did not remove styles'
  }
  Write-Output 'ops: clone->rename->undo->redo->delete->undo->redo OK'

  Write-Output 'INTEGRATION-OK'
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
  if (Test-Path -LiteralPath $testSkin) {
    Remove-Item -LiteralPath $testSkin -Recurse -Force
  }
  if ($clonedPath -and (Test-Path -LiteralPath $clonedPath)) {
    Remove-Item -LiteralPath $clonedPath -Recurse -Force
  }
  if (Test-Path -LiteralPath $profilePath) {
    Remove-Item -LiteralPath $profilePath -Force
  }
  Remove-Item -LiteralPath $portFile -ErrorAction SilentlyContinue
}
