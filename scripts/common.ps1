$script:RepoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))

function Get-NodeExecutable {
    $manifest = Get-Content -LiteralPath (Join-Path $script:RepoRoot 'toolchain.json') -Raw | ConvertFrom-Json
    $portable = Join-Path (Join-Path $script:RepoRoot '.tools') $manifest.node.executable
    if (Test-Path -LiteralPath $portable -PathType Leaf) { $nodeExe = $portable }
    else {
        $command = Get-Command node -ErrorAction SilentlyContinue
        if (-not $command) { throw 'Node is missing. Run scripts/setup.ps1 first.' }
        $nodeExe = $command.Source
    }
    $version = & $nodeExe --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.') { throw 'Cannot run Node. Run scripts/setup.ps1.' }
    $major = [int]$Matches[1]
    if ($major -lt 24 -or $major % 2 -ne 0) { throw "Supported Node LTS >=24 required (found $version). Run scripts/setup.ps1." }
    return $nodeExe
}

function Invoke-HostUtility {
    param([string[]]$Arguments)
    $nodeExe = Get-NodeExecutable
    & $nodeExe (Join-Path $script:RepoRoot 'scripts/host.mjs') @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Host command failed with exit code $LASTEXITCODE." }
}

function Get-PublishingSettings {
    $nodeExe = Get-NodeExecutable
    Push-Location $script:RepoRoot
    try {
        $json = & $nodeExe --input-type=module -e "import {loadConfig,toolEnvironment} from './scripts/host-lib.mjs'; const env=await toolEnvironment(process.cwd(),await loadConfig(process.cwd())); console.log(JSON.stringify({PANDOC_BIN:env.PANDOC_BIN,PUPPETEER_CACHE_DIR:env.PUPPETEER_CACHE_DIR,BROWSER_EXECUTABLE:env.BROWSER_EXECUTABLE||''}));"
        if ($LASTEXITCODE -ne 0) { throw 'Cannot load publishing settings.' }
        return ($json | ConvertFrom-Json)
    } finally { Pop-Location }
}
