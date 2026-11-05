param([Parameter(Mandatory=$true)][string]$Folder)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# Metadata only. Never read contents, recurse, pin or hydrate documents.
$rows = @()
foreach ($item in (Get-Item -LiteralPath $Folder -Force).GetFileSystemInfos()) {
    $rows += @{ name = $item.Name; attributes = [int64]$item.Attributes }
    if ($rows.Count -gt 10000) { throw 'Folder too large.' }
}
ConvertTo-Json -InputObject $rows -Compress
