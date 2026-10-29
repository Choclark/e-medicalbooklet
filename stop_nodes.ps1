<#
.SYNOPSIS
    Stop all active nodes, C++ cores, and broadcast servers for E-Medical Booklet
#>
$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

$RunDir = Join-Path $ScriptDir ".run"
$StateFile = Join-Path $RunDir "active_nodes.json"

Write-Host "======================================================================" -ForegroundColor Red
Write-Host "         STOPPING E-MEDICAL BOOKLET NODES & BLOCKCHAIN CORES          " -ForegroundColor Red
Write-Host "======================================================================" -ForegroundColor Red

function Stop-ProcessTree([int]$pidVal) {
    if ($pidVal -gt 0) {
        & taskkill.exe /F /T /PID $pidVal 2>$null | Out-Null
        Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path $StateFile) {
    try {
        $content = Get-Content $StateFile -Raw | ConvertFrom-Json
        foreach ($inst in $content.instances) {
            if ($inst.node_pid -gt 0) {
                Write-Host "[-] Stopping Node PID $($inst.node_pid) ($($inst.node_id))..." -ForegroundColor Yellow
                Stop-ProcessTree $inst.node_pid
            }
            if ($inst.core_pid -gt 0) {
                Write-Host "[-] Stopping Core PID $($inst.core_pid)..." -ForegroundColor Yellow
                Stop-ProcessTree $inst.core_pid
            }
        }
    } catch {
        Write-Warning "Could not parse $StateFile"
    }
}

# Clean any remaining .pid files
if (Test-Path $RunDir) {
    Get-ChildItem -Path $RunDir -Filter "*.pid" | ForEach-Object {
        $pidVal = Get-Content $_.FullName
        if ($pidVal -match '^\d+$') {
            Stop-ProcessTree ([int]$pidVal)
        }
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    }
    Set-Content -Path $StateFile -Value '{"instances":[]}' -Force
}

Write-Host "`n[OK] All nodes, cores, and broadcast servers have been stopped." -ForegroundColor Green
