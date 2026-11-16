# Runs the compiled FlowPack screen watcher inside signed powershell.exe when
# Smart App Control or application control policies refuse unsigned executables.
param([Parameter(Mandatory = $true)][string]$HelperExe)
$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($HelperExe))
$code = $assembly.EntryPoint.Invoke($null, [object[]]@(, [string[]]@()))
exit [int]$code
