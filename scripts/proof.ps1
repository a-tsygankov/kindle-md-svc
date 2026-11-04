param(
    [string[]]$InputFiles = @(),
    [string]$Out = 'output/proof'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$nodeExe = Get-NodeExecutable
$settings = Get-PublishingSettings
$savedPandoc = $env:PANDOC_BIN
$savedCache = $env:PUPPETEER_CACHE_DIR
$savedBrowser = $env:BROWSER_EXECUTABLE
Push-Location $script:RepoRoot
try {
    $env:PANDOC_BIN = $settings.PANDOC_BIN
    $env:PUPPETEER_CACHE_DIR = $settings.PUPPETEER_CACHE_DIR
    $env:BROWSER_EXECUTABLE = $settings.BROWSER_EXECUTABLE
    & $nodeExe 'spike/convert.mjs' '--out' $Out @InputFiles
    if ($LASTEXITCODE -ne 0) { throw "Conversion failed with exit code $LASTEXITCODE" }
} finally {
    $env:PANDOC_BIN = $savedPandoc
    $env:PUPPETEER_CACHE_DIR = $savedCache
    $env:BROWSER_EXECUTABLE = $savedBrowser
    Pop-Location
}
