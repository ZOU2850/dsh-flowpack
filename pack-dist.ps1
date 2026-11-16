param(
  [string]$OutDir = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
if (!(Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$Pkg = Get-Content -Path (Join-Path $PSScriptRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ArchiveName = "$($Pkg.name)-v$($Pkg.version).zip"
$ArchivePath = Join-Path $OutDir $ArchiveName
if (Test-Path $ArchivePath) {
  Remove-Item -LiteralPath $ArchivePath -Force
}

$TempStage = Join-Path $OutDir "_stage_$($Pkg.name)"
if (Test-Path $TempStage) {
  Remove-Item -LiteralPath $TempStage -Recurse -Force
}
$StagePlugin = Join-Path $TempStage $Pkg.name
New-Item -ItemType Directory -Path $StagePlugin -Force | Out-Null

$IncludeItems = @(
  'package.json', 'cordis.patch.yml', 'icon.svg', 'index.js', 'client.js',
  'README.md', 'README.zh.md', 'LICENSE', 'install-profile.ps1', 'install.cmd',
  'locale', 'lib'
)
foreach ($Item in $IncludeItems) {
  $Src = Join-Path $PSScriptRoot $Item
  if (Test-Path $Src) {
    Copy-Item -Path $Src -Destination (Join-Path $StagePlugin $Item) -Recurse -Force
  }
}

Compress-Archive -Path $StagePlugin -DestinationPath $ArchivePath -Force
Remove-Item -LiteralPath $TempStage -Recurse -Force
Write-Host "Built distributable bundle: $ArchivePath"
