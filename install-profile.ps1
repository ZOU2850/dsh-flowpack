param(
  [string]$ProfileName = 'desktop',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$PluginDir = $PSScriptRoot
$PkgJsonPath = Join-Path $PluginDir 'package.json'
if (!(Test-Path $PkgJsonPath)) {
  throw "package.json not found in $PluginDir"
}

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$PluginManifest = Get-Content -Path $PkgJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$PluginName = [string]$PluginManifest.name

$ProfileDir = Join-Path (Join-Path $DshHome 'profiles') $ProfileName
$ProfilePkgPath = Join-Path $ProfileDir 'package.json'
$NodeModulesDir = Join-Path $ProfileDir 'node_modules'
$TargetLink = Join-Path $NodeModulesDir $PluginName

if (!(Test-Path $ProfilePkgPath)) {
  throw "Target DSH profile package.json not found: $ProfilePkgPath"
}

$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupPath = "$ProfilePkgPath.bak-$Timestamp"
Copy-Item -Path $ProfilePkgPath -Destination $BackupPath -Force
Write-Host "Backed up $ProfilePkgPath -> $BackupPath"

$RawJson = Get-Content -Path $ProfilePkgPath -Raw -Encoding UTF8
$ProfilePkg = $RawJson | ConvertFrom-Json

if ($Uninstall) {
  if ($ProfilePkg.dependencies -and ($ProfilePkg.dependencies.PSObject.Properties.Name -contains $PluginName)) {
    $ProfilePkg.dependencies.PSObject.Properties.Remove($PluginName)
  }
  if ($ProfilePkg.dsh -and $ProfilePkg.dsh.profile -and $ProfilePkg.dsh.profile.bundles) {
    $ProfilePkg.dsh.profile.bundles = @($ProfilePkg.dsh.profile.bundles | Where-Object { $_ -ne $PluginName })
  }
  $OutJson = ($ProfilePkg | ConvertTo-Json -Depth 12) + "`n"
  [System.IO.File]::WriteAllText($ProfilePkgPath, $OutJson, $Utf8NoBom)

  if (Test-Path $TargetLink) {
    $Item = Get-Item -LiteralPath $TargetLink -Force
    if ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      cmd /c rmdir "`"$TargetLink`"" | Out-Null
      Write-Host "Removed junction: $TargetLink"
    } else {
      Remove-Item -LiteralPath $TargetLink -Recurse -Force
      Write-Host "Removed directory: $TargetLink"
    }
  }
  Write-Host "Uninstalled $PluginName from DSH profile '$ProfileName'. Restart DeepSeek Harness Desktop."
  exit 0
}

# Install mode
if (!(Test-Path $NodeModulesDir)) {
  New-Item -ItemType Directory -Path $NodeModulesDir -Force | Out-Null
}

if (Test-Path $TargetLink) {
  $Item = Get-Item -LiteralPath $TargetLink -Force
  if ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    cmd /c rmdir "`"$TargetLink`"" | Out-Null
  } else {
    Remove-Item -LiteralPath $TargetLink -Recurse -Force
  }
}

cmd /c mklink /J "`"$TargetLink`"" "`"$PluginDir`"" | Out-Null
if (!(Test-Path $TargetLink)) {
  throw "Failed to create Windows junction at $TargetLink"
}

if ($null -eq $ProfilePkg.dependencies) {
  $ProfilePkg | Add-Member -MemberType NoteProperty -Name 'dependencies' -Value ([pscustomobject]@{})
}
$ForwardPluginPath = 'link:' + ($PluginDir -replace '\\', '/')
if ($ProfilePkg.dependencies.PSObject.Properties.Name -contains $PluginName) {
  $ProfilePkg.dependencies.$PluginName = $ForwardPluginPath
} else {
  $ProfilePkg.dependencies | Add-Member -MemberType NoteProperty -Name $PluginName -Value $ForwardPluginPath
}

if ($null -eq $ProfilePkg.dsh) {
  $ProfilePkg | Add-Member -MemberType NoteProperty -Name 'dsh' -Value ([pscustomobject]@{})
}
if ($null -eq $ProfilePkg.dsh.profile) {
  $ProfilePkg.dsh | Add-Member -MemberType NoteProperty -Name 'profile' -Value ([pscustomobject]@{})
}
$ExistingBundles = @($ProfilePkg.dsh.profile.bundles)
if ($ExistingBundles -notcontains $PluginName) {
  $ProfilePkg.dsh.profile.bundles = @($ExistingBundles + $PluginName)
}

$OutJson = ($ProfilePkg | ConvertTo-Json -Depth 12) + "`n"
[System.IO.File]::WriteAllText($ProfilePkgPath, $OutJson, $Utf8NoBom)

Write-Host "Installed $PluginName into DSH profile '$ProfileName' via junction: $TargetLink"
Write-Host "Next step: Restart DeepSeek Harness Desktop to load $PluginName."
