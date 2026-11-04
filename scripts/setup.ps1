param([string]$SourceDir, [switch]$SkipToolDownloads, [switch]$RepairTools)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'common.ps1')
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'Portable setup currently supports Windows x64. See docs/OPERATIONS.md for manual macOS setup.'
}
. (Join-Path $PSScriptRoot 'bootstrap-guard.ps1')
Assert-BootstrapSourceSafety -Repo $script:RepoRoot -SourceOverride $SourceDir -HasSourceOverride $PSBoundParameters.ContainsKey('SourceDir')
$manifest = Get-Content -LiteralPath (Join-Path $script:RepoRoot 'toolchain.json') -Raw | ConvertFrom-Json
$toolsDir = Join-Path $script:RepoRoot '.tools'
$stateDir = Join-Path $script:RepoRoot '.state'
foreach ($directory in @($toolsDir, $stateDir, (Join-Path $script:RepoRoot 'node_modules'), (Join-Path $script:RepoRoot 'dist'))) {
    if (Test-Path -LiteralPath $directory) {
        $item = Get-Item -LiteralPath $directory -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing redirected managed directory: $directory"
        }
    }
}
$serviceLockFile = Join-Path $stateDir 'service.lock'
if (Test-Path -LiteralPath $serviceLockFile) {
    $serviceOwner = Get-Content -LiteralPath $serviceLockFile -Raw | ConvertFrom-Json
    if (Get-Process -Id $serviceOwner.pid -ErrorAction SilentlyContinue) { throw 'Stop the active service before setup.' }
}
$runFile = Join-Path $stateDir 'run.json'
if (Test-Path -LiteralPath $runFile) {
    $runState = Get-Content -LiteralPath $runFile -Raw | ConvertFrom-Json
    if ($runState.status -in @('starting','running','stopping')) { throw 'Stop or resolve the managed run before setup.' }
}
$lockFile = Join-Path $script:RepoRoot '.host-operation.lock'
$lockToken = [Guid]::NewGuid().ToString()
$lockHandle = [IO.File]::Open($lockFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    $lockBytes = [Text.Encoding]::UTF8.GetBytes((@{pid=$PID;token=$lockToken} | ConvertTo-Json -Compress))
    $lockHandle.Write($lockBytes, 0, $lockBytes.Length)
} finally { $lockHandle.Dispose() }
$savedPath = $env:PATH
$savedCache = $env:PUPPETEER_CACHE_DIR
Push-Location $script:RepoRoot
try {
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    if (-not $SkipToolDownloads) {
        foreach ($tool in @($manifest.node, $manifest.pandoc)) {
            $executable = Join-Path $toolsDir $tool.executable
            if ((Test-Path -LiteralPath $executable) -and -not $RepairTools) { continue }
            $archive = Join-Path $toolsDir $tool.archive
            if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $tool.sha256) {
                Write-Host "Downloading $($tool.archive) ..."
                $downloadFile = "$archive.download"
                Invoke-WebRequest -UseBasicParsing -Uri $tool.url -OutFile $downloadFile
                if ((Get-FileHash -LiteralPath $downloadFile -Algorithm SHA256).Hash -ne $tool.sha256) { throw "Checksum mismatch: $($tool.archive)" }
                Move-Item -LiteralPath $downloadFile -Destination $archive -Force
            }
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $tool.sha256) { throw 'Archive checksum mismatch.' }
            Expand-Archive -LiteralPath $archive -DestinationPath $toolsDir -Force
        }
    }
    $nodeExe = Get-NodeExecutable
    $configArgs = @('configure')
    if ($PSBoundParameters.ContainsKey('SourceDir')) { $configArgs += "--source=$SourceDir" }
    Invoke-HostUtility -Arguments $configArgs
    # Check source overlap before npm ci can replace dependencies or write a browser cache.
    Invoke-HostUtility -Arguments @('reset-plan', '--dependencies', '--tools') | Out-Null
    $env:PATH = (Split-Path -Parent $nodeExe) + [IO.Path]::PathSeparator + $savedPath
    $env:PUPPETEER_CACHE_DIR = Join-Path $toolsDir 'puppeteer'
    $npmCli = Join-Path (Split-Path -Parent $nodeExe) 'node_modules/npm/bin/npm-cli.js'
    Write-Host 'Installing locked npm dependencies ...'
    if (Test-Path -LiteralPath $npmCli) { & $nodeExe $npmCli ci --no-fund }
    else { & (Get-Command npm -ErrorAction Stop).Source ci --no-fund }
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & $nodeExe 'node_modules/puppeteer/install.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Puppeteer browser installation failed.' }
    Invoke-HostUtility -Arguments @('build')
    Invoke-HostUtility -Arguments @('doctor')
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    $setupJson = @{schemaVersion=1; completedAt=[DateTime]::UtcNow.ToString('o'); node=(& $nodeExe --version); requestedPandoc=$manifest.pandoc.version} | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $stateDir 'setup.json'), $setupJson, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Setup complete. Run scripts/start.ps1 -Open for the picker, or scripts/proof.ps1 for synthetic samples.'
} finally {
    $env:PATH = $savedPath
    $env:PUPPETEER_CACHE_DIR = $savedCache
    Pop-Location
    if (Test-Path -LiteralPath $lockFile) {
        $ownedLock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
        if ($ownedLock.token -eq $lockToken) { Remove-Item -LiteralPath $lockFile -Force }
    }
}
