param([string[]]$Files = @(), [switch]$Proof, [switch]$Open)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$commandArgs = @('start')
if ($Open -and -not $Proof -and -not $Files.Count) {
    $current = Invoke-HostUtility -Arguments @('status')
    $info = ($current -join [Environment]::NewLine) | ConvertFrom-Json
    if ($info.mode -eq 'publishing-service' -and $info.status -eq 'running') {
        & (Join-Path $PSScriptRoot 'open.ps1')
        $current | Write-Output
        return
    }
}
if ($Proof) { $commandArgs += '--proof' }
foreach ($file in $Files) { $commandArgs += "--file=$file" }
Invoke-HostUtility -Arguments $commandArgs
if ($Open -and -not $Proof -and -not $Files.Count) { & (Join-Path $PSScriptRoot 'open.ps1') }
