$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$result = Invoke-HostUtility -Arguments @('status')
$info = ($result -join [Environment]::NewLine) | ConvertFrom-Json
if ($info.mode -ne 'publishing-service' -or $info.status -ne 'running' -or -not $info.url) { throw 'Start the publishing service first with scripts/start.ps1.' }
$tokenPath = Join-Path $script:RepoRoot '.state/access-token'
if ((Get-Item -LiteralPath $tokenPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Access-token file must not be redirected.' }
$token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
$target = $info.url + '/#token=' + [Uri]::EscapeDataString($token)
# URL fragments are not sent to the server; the UI clears it after local login.
# Do not print the token or the connection URL containing it.
Start-Process -FilePath $target
