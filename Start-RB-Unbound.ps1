$ErrorActionPreference = 'Stop'
$site = 'http://127.0.0.1:3001'

function Test-GameHost {
    try {
        $response = Invoke-RestMethod -Uri "$site/healthz" -TimeoutSec 2
        return $response.status -eq 'ok'
    } catch {
        return $false
    }
}

try {
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'npm was not found. Install Node.js, then try again.'
    }

    $cloudflared = @(
        (Join-Path $env:USERPROFILE 'Downloads\cloudflared-windows-amd64.exe'),
        (Join-Path $PSScriptRoot 'cloudflared-windows-amd64.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $cloudflared) {
        $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
        if ($command) { $cloudflared = $command.Source }
    }
    if (-not $cloudflared) {
        throw "cloudflared-windows-amd64.exe was not found in Downloads or beside this launcher. Put the downloaded file in either location and try again."
    }

    if (Test-GameHost) {
        Write-Host "Game server is already running at $site."
    } else {
        if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
            throw 'Port 3001 is in use by another program. Close it before starting the game server.'
        }
        Write-Host 'Opening the game server window and waiting for the build to finish...'
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'npm run host:site' -WorkingDirectory $PSScriptRoot
        $deadline = (Get-Date).AddSeconds(120)
        while (-not (Test-GameHost) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
        }
        if (-not (Test-GameHost)) {
            throw 'The game server did not start within two minutes. Check the game server window for an error.'
        }
        Write-Host "Game server is ready at $site."
    }

    if (Get-Process -Name 'cloudflared-windows-amd64', 'cloudflared' -ErrorAction SilentlyContinue) {
        Write-Host 'Cloudflare Tunnel is already running. Use the trycloudflare.com URL in its existing window.'
    } else {
        Write-Host 'Opening the Cloudflare Tunnel window...'
        Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', $site) -WorkingDirectory $PSScriptRoot
        Write-Host 'Use the trycloudflare.com URL printed in the new Cloudflare window.'
    }
    Write-Host 'Keep the game server and Cloudflare windows open while playing.'
} catch {
    Write-Host "Could not start RB Unbound: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
