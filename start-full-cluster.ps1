<#
.SYNOPSIS
    One-Command E-Medical Booklet Full Sovereign Stack Launcher for Windows
.DESCRIPTION
    Spawns the entire production cluster in visible, dedicated command windows:
      1. Central Broadcast Server (TCP 9099 / WS 9100)
      2. 4 Standalone C++ KSM Core Daemons (HOSPITAL_A..D on :9101..:9104)
      3. 3 PBFT Validator Nodes with C++ Blockchain Cores (val-01, val-02, val-03)
      4. 1 Archive Node with Cold Storage & Pruning (archive-01)
      5. 1 Client Node with WebSocket Gateway (:8765)
      6. Next.js Web Portal (:3000)
.PARAMETER LaunchPortal
    Also launch the Next.js Web Portal (default: $true)
#>

[CmdletBinding()]
param (
    [switch]$NoPortal
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "======================================================================" -ForegroundColor Magenta
Write-Host "         STARTING FULL E-MEDICAL BOOKLET SOVEREIGN CLUSTER            " -ForegroundColor Magenta
Write-Host "======================================================================" -ForegroundColor Magenta

# 1. Clean any existing stale instances
Write-Host "[*] Checking and cleaning existing processes..." -ForegroundColor Cyan
& "$ScriptDir\stop_nodes.ps1"
Start-Sleep -Seconds 1

# 2. Launch the full cluster using launch_nodes.ps1
Write-Host "`n[*] Launching PBFT validators, KSM daemons, archive node, and client gateway..." -ForegroundColor Cyan
& "$ScriptDir\launch_nodes.ps1" -Type cluster

# 3. Launch Next.js Web Portal if requested
if (-not $NoPortal) {
    Write-Host "`n[*] Launching Next.js Web Portal (:3000) in dedicated CMD window..." -ForegroundColor Cyan
    $portalCmd = "cmd.exe /k `"title [PulseClinic Web Portal : 3000] && cd /d `"`"$ScriptDir\pulseclinic`"`" && npm run dev`""
    $pProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/k `"title [PulseClinic Web Portal : 3000] && cd /d `"`"$ScriptDir\pulseclinic`"`" && npm run dev`"" -PassThru
    Set-Content -Path "$ScriptDir\.run\portal.pid" -Value $pProc.Id
    Write-Host "    [+] Next.js Portal launching on http://localhost:3000 (CMD PID: $($pProc.Id))" -ForegroundColor Green
}

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host " [SUCCESS] FULL CLUSTER IS ACTIVE & LISTENING" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  - Web Portal UI:        http://localhost:3000" -ForegroundColor Cyan
Write-Host "  - Client Node Gateway:  ws://127.0.0.1:8765" -ForegroundColor Cyan
Write-Host "  - Broadcast Server:     127.0.0.1:9099 (WS: 9100)" -ForegroundColor Cyan
Write-Host "  - PBFT Validators:      val-01, val-02, val-03 (2f+1 Quorum)" -ForegroundColor Cyan
Write-Host "  - KSM Hospital Daemons: HOSPITAL_A (:9101), HOSPITAL_B (:9102), HOSPITAL_C (:9103), HOSPITAL_D (:9104)" -ForegroundColor Cyan
Write-Host "  - Cold Archive Node:    archive-01 (chaindata/archive-01/archives/)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "To shut down the entire cluster at any time, run: .\stop_nodes.ps1`n" -ForegroundColor Yellow
