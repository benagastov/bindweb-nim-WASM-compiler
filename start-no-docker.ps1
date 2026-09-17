param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080,
    [switch]$BuildOnly,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$buildScript = Join-Path $repoRoot 'build.bat'
$distDir = Join-Path $repoRoot 'dist'

$pythonCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python39\python.exe'),
    (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$python = $pythonCandidates | Select-Object -First 1
if (-not $python) {
    throw 'Python 3 is required to serve the generated site, but python.exe was not found.'
}

Write-Host 'Building BindWeb locally without Docker...'
Write-Host 'Trying pinned prebuilt artifacts, with a pinned native fallback.'
& $buildScript all
if ($LASTEXITCODE -ne 0) {
    throw "BindWeb build failed with exit code $LASTEXITCODE"
}

if ($BuildOnly) {
    Write-Host "Build complete: $distDir"
    exit 0
}

$url = "http://localhost:$Port"
Write-Host "Serving BindWeb at $url"
Write-Host 'Press Ctrl+C to stop the server.'

if (-not $NoBrowser) {
    Start-Process $url
}

& $python -m http.server $Port --directory $distDir
exit $LASTEXITCODE
