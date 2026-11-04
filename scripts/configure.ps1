param(
    [string]$SourceDir, [string]$PandocPath, [string]$BrowserPath,
    [string]$ListenHost, [int]$Port,
    [string]$SmtpHost, [int]$SmtpPort, [ValidateSet('tls','starttls','none')][string]$SmtpSecurity,
    [string]$SmtpFrom, [string]$KindleEmail, [string]$SmtpUser, [string]$SmtpPasswordEnv,
    [switch]$EnableEmail, [switch]$DisableEmail, [switch]$ClearSource, [switch]$Show
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
if ($Show) { Invoke-HostUtility -Arguments @('config'); return }
$commandArgs = @('configure')
if ($PSBoundParameters.ContainsKey('SourceDir')) { $commandArgs += "--source=$SourceDir" }
if ($PSBoundParameters.ContainsKey('PandocPath')) { $commandArgs += "--pandoc=$PandocPath" }
if ($PSBoundParameters.ContainsKey('BrowserPath')) { $commandArgs += "--browser=$BrowserPath" }
if ($ClearSource) { $commandArgs += '--clear-source' }
foreach ($mapping in @(
    @('ListenHost','host'), @('Port','port'), @('SmtpHost','smtp-host'), @('SmtpPort','smtp-port'),
    @('SmtpSecurity','smtp-security'), @('SmtpFrom','smtp-from'), @('KindleEmail','kindle-email'),
    @('SmtpUser','smtp-user'), @('SmtpPasswordEnv','smtp-password-env')
)) {
    if ($PSBoundParameters.ContainsKey($mapping[0])) { $commandArgs += "--$($mapping[1])=$($PSBoundParameters[$mapping[0]])" }
}
if ($EnableEmail) { $commandArgs += '--enable-email' }
if ($DisableEmail) { $commandArgs += '--disable-email' }
Invoke-HostUtility -Arguments $commandArgs
