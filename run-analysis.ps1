param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
    [string]$Project,
    [switch]$DryRun,
    [switch]$Offline,
    [switch]$VerifyProcessed
)

$ErrorActionPreference = 'Stop'

$analyticsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location -LiteralPath $analyticsRoot

try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        throw 'Dipendenze mancanti. Eseguire prima: npm install'
    }

    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { $null }
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    $nodeCandidates = @(
        (Join-Path $userProfile '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
        'C:\Program Files\nodejs\node.exe'
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )

    if (-not $nodeExecutable) {
        $nodeExecutable = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $nodeExecutable) {
        throw 'Node.js non trovato. Installare Node.js 24 oppure aggiungerlo al PATH.'
    }

    $analysisArguments = @('--project', $Project)
    if ($DryRun) { $analysisArguments += '--dry-run' }
    if ($Offline) { $analysisArguments += '--offline' }
    if ($VerifyProcessed) { $analysisArguments += '--verify-processed' }

    & $nodeExecutable '.\scripts\analyze.mjs' @analysisArguments
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
