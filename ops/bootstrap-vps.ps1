[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'YesterdaysLemon/agar-protocol'
$webhookUrl = 'https://deploy.alirezaafshan.com/deploy/agar'
$publicHealth = 'https://agar.alirezaafshan.com/healthz'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localBootstrap = Join-Path $PSScriptRoot 'bootstrap-vps.sh'
$remoteBootstrap = '/home/ali/agar-protocol-bootstrap.sh'
$remoteSecret = '/home/ali/.agar-protocol-deploy-secret'
$sshArgs = @(
    '-o', 'HostName=deploy.alirezaafshan.com',
    '-o', 'HostKeyAlias=alirezaafshan.com',
    'alirezaafshan.com'
)
$transportArgs = $sshArgs[0..3]

if (-not (Test-Path -LiteralPath $localBootstrap)) {
    throw "Missing bootstrap script: $localBootstrap"
}

Push-Location $repoRoot
try {
    & gh auth status | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI authentication is required.' }

    & gh api "repos/$repo" --silent
    if ($LASTEXITCODE -ne 0) { throw "GitHub repository is not reachable: $repo" }

    & scp -q @transportArgs $localBootstrap "alirezaafshan.com:$remoteBootstrap"
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the VPS bootstrap script.' }

    & ssh @sshArgs "chmod 700 '$remoteBootstrap' && rm -f '$remoteSecret'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the staged VPS bootstrap script.' }

    Write-Host ''
    Write-Host 'One sudo password prompt may follow. The bootstrap is backup-first and rollback-safe.'
    & ssh -t @sshArgs "sudo '$remoteBootstrap'"
    if ($LASTEXITCODE -ne 0) { throw 'The VPS bootstrap did not complete.' }

    $deploySecret = (& ssh @sshArgs "cat '$remoteSecret'") -join ''
    $deploySecret = $deploySecret.Trim()
    if ($LASTEXITCODE -ne 0 -or $deploySecret -notmatch '^[a-f0-9]{64}$') {
        throw 'The VPS completed, but its generated webhook secret could not be retrieved safely.'
    }

    $deploySecret | & gh secret set DEPLOY_WEBHOOK_SECRET --repo $repo
    if ($LASTEXITCODE -ne 0) { throw 'Could not set DEPLOY_WEBHOOK_SECRET.' }

    $webhookUrl | & gh secret set DEPLOY_WEBHOOK_URL --repo $repo
    if ($LASTEXITCODE -ne 0) { throw 'Could not set DEPLOY_WEBHOOK_URL.' }

    & gh variable set DEPLOY_ENABLED --repo $repo --body true
    if ($LASTEXITCODE -ne 0) { throw 'Could not enable production CD.' }

    & ssh @sshArgs "rm -f '$remoteBootstrap' '$remoteSecret'"
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Deployment succeeded, but remote staging cleanup needs to be retried.'
    }

    $health = $null
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $publicHealth -TimeoutSec 10
            if ($health.ok -and $health.app -eq 'agar-protocol') { break }
        }
        catch {
            if ($attempt -eq 30) { throw }
        }
        Start-Sleep -Seconds 2
    }
    if ($null -eq $health -or -not $health.ok -or $health.app -ne 'agar-protocol') {
        throw "Unexpected public health response from $publicHealth"
    }

    Write-Host ''
    Write-Host 'Agar Protocol is deployed and continuous deployment is enabled.'
    Write-Host 'Production: https://agar.alirezaafshan.com/'
}
finally {
    Pop-Location
}
