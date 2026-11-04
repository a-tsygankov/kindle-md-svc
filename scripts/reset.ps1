[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$IncludeDependencies, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$commandArgs = @('reset')
if ($IncludeDependencies) { $commandArgs += '--dependencies' }
if ($DryRun -or $WhatIfPreference) { $commandArgs += '--dry-run' }
if ($DryRun -or $WhatIfPreference -or $PSCmdlet.ShouldProcess('managed output/.state directories', 'Reset generated state (preserve source/config/tools)')) {
    Invoke-HostUtility -Arguments $commandArgs
}
