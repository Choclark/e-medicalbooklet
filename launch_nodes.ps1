<#
.SYNOPSIS
    E-Medical Booklet Multi-Node & Core Orchestration Launcher for Windows PowerShell
.DESCRIPTION
    Dynamically finds free ports, checks/launches the broadcast server, and spawns each
    Python node and C++ core in its own dedicated, visible CMD window.
.PARAMETER Type
    Role of the node: validator, ksm, client, archive, all, cluster, broadcast, or status
.PARAMETER Count
    Number of nodes and cores to launch (default: 1)
.PARAMETER Broadcast
    Broadcast server address (default: 127.0.0.1:9099)
.PARAMETER ChainId
    Blockchain Channel ID (default: 0)
.PARAMETER Status
    Display status table of all active nodes, ports, and PIDs
.EXAMPLE
    .\launch_nodes.ps1 -Type validator -Count 2
    .\launch_nodes.ps1 -Type ksm -Count 3
    .\launch_nodes.ps1 -Type archive -Count 1
    .\launch_nodes.ps1 -Type client -Count 1
    .\launch_nodes.ps1 -Type all
    .\launch_nodes.ps1 -Status
#>

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet("validator", "ksm", "client", "archive", "all", "cluster", "broadcast", "status")]
    [string]$Type = "validator",

    [Parameter(Position = 1)]
    [int]$Count = 1,

    [string]$Broadcast = "127.0.0.1:9099",
    [int]$ChainId = 0,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

$RunDir = Join-Path $ScriptDir ".run"
$LogsDir = Join-Path $ScriptDir "logs"
$StateFile = Join-Path $RunDir "active_nodes.json"

if (-not (Test-Path $RunDir)) { New-Item -ItemType Directory -Path $RunDir | Out-Null }
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }

# Locate Python Virtual Environment
$PythonBin = if (Test-Path "$ScriptDir\node\.venv\Scripts\python.exe") {
    "$ScriptDir\node\.venv\Scripts\python.exe"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    (Get-Command python).Source
} else {
    throw "Python executable not found!"
}

# Locate C++ Core Binaries
function Get-BlockchainCorePath {
    $paths = @(
        "$ScriptDir\blockchain-core\build\Release\blockchain_core.exe",
        "$ScriptDir\build\Release\blockchain_core.exe",
        "$ScriptDir\blockchain-core\build\Debug\blockchain_core.exe",
        "$ScriptDir\build\Debug\blockchain_core.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    return $null
}

function Get-KsmCorePath {
    $paths = @(
        "$ScriptDir\blockchain-core\build\Release\ksm_core.exe",
        "$ScriptDir\build\Release\ksm_core.exe",
        "$ScriptDir\blockchain-core\build\Debug\ksm_core.exe",
        "$ScriptDir\build\Debug\ksm_core.exe",
        "$ScriptDir\ksm-core\build\Debug\ksm_core.exe",
        "$ScriptDir\build-ksm\Debug\ksm_core.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    return $null
}

$BlockchainCoreBin = Get-BlockchainCorePath
$KsmCoreBin = Get-KsmCorePath

# Helper: Generate formatted node id: val-01 if < 10, val-10 if >= 10
function Get-NodeId([string]$Prefix, [int]$Idx) {
    $n = if ($Idx -lt 10) { "0$Idx" } else { "$Idx" }
    return "$Prefix-$n"
}

# Helper: Test if port is actively open
function Test-PortOpen([string]$HostAddress, [int]$Port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $connect = $client.BeginConnect($HostAddress, $Port, $null, $null)
        $success = $connect.AsyncWaitHandle.WaitOne(600, $false)
        if ($success -and $client.Connected) {
            $client.EndConnect($connect)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

# Helper: Dynamically find unused TCP port
function Find-FreePort([int]$StartPort, [int[]]$ExcludePorts = @()) {
    $p = $StartPort
    $exclude = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($ep in $ExcludePorts) { [void]$exclude.Add($ep) }
    while ($p -lt 65000) {
        if (-not $exclude.Contains($p) -and -not ($p -ge 50060 -and $p -le 50159)) {
            $listener = $null
            try {
                $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $p)
                $listener.Start()
                $listener.Stop()
                return $p
            } catch {
            } finally {
                if ($listener) { $listener.Stop() }
            }
        }
        $p++
    }
    throw "No free port found starting from $StartPort"
}

# Helper: Open dedicated visible CMD window for process
function Start-CmdProcess([string]$Title, [string]$Command) {
    $cmdArgs = "/k `"title $Title && cd /d `"`"$ScriptDir`"`" && $Command`""
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -PassThru
    return $proc
}

# Helper: Persist active instance metadata
function Save-ActiveInstance {
    param($NodeId, $Role, $NodePid, $NodePort, $CorePid = 0, $CorePort = 0, $Extra = "")
    $data = [PSCustomObject]@{ instances = @() }
    if (Test-Path $StateFile) {
        try {
            $parsed = Get-Content $StateFile -Raw | ConvertFrom-Json
            if ($parsed.instances) {
                $data = $parsed
            }
        } catch {}
    }
    $record = [PSCustomObject]@{
        node_id    = [string]$NodeId
        role       = [string]$Role
        node_pid   = [int]$NodePid
        node_port  = [int]$NodePort
        core_pid   = [int]$CorePid
        core_port  = [int]$CorePort
        extra      = [string]$Extra
        started_at = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    }
    $list = [System.Collections.Generic.List[object]]::new()
    if ($data.instances) {
        foreach ($item in $data.instances) { $list.Add($item) }
    }
    $list.Add($record)
    $data.instances = $list
    $data | ConvertTo-Json -Depth 5 | Set-Content -Path $StateFile -Force
}

# Helper: Display cluster status table
function Show-ClusterStatus {
    Write-Host "`n======================================================================" -ForegroundColor Cyan
    Write-Host "               ACTIVE E-MEDICAL BOOKLET INSTANCES                     " -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Cyan
    if (-not (Test-Path $StateFile)) {
        Write-Host "No active instances found in $StateFile" -ForegroundColor Yellow
        return
    }
    $content = Get-Content $StateFile -Raw | ConvertFrom-Json
    $fmt = "{0,-16} {1,-12} {2,-10} {3,-11} {4,-11} {5,-9} {6,-15}"
    [string]::Format($fmt, "NODE ID", "ROLE", "NODE PID", "NODE PORT", "CORE PORT", "STATUS", "EXTRA") | Write-Host
    Write-Host ("-" * 86)
    foreach ($inst in $content.instances) {
        $alive = if ($inst.node_port -gt 0) { Test-PortOpen "127.0.0.1" $inst.node_port } else { $false }
        $status = if ($alive) { "RUNNING" } else { "STOPPED" }
        $cport = if ($inst.core_port -gt 0) { $inst.core_port.ToString() } else { "N/A" }
        $color = if ($alive) { "Green" } else { "Red" }
        $line = [string]::Format($fmt, $inst.node_id, $inst.role, $inst.node_pid, $inst.node_port, $cport, $status, $inst.extra)
        Write-Host $line -ForegroundColor $color
    }
    Write-Host "======================================================================`n" -ForegroundColor Cyan
}

if ($Status -or $Type -eq "status") {
    Show-ClusterStatus
    return
}

# Step 1: Ensure Broadcast Server on 9099
$bParts = $Broadcast.Split(":")
$bHost = $bParts[0]
$bPort = [int]$bParts[1]

Write-Host "----------------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "[*] Step 1: Checking Broadcast Server ($($bHost):$($bPort))..." -ForegroundColor Cyan
if (Test-PortOpen $bHost $bPort) {
    Write-Host "[OK] Broadcast Server is already active on $($bHost):$($bPort)." -ForegroundColor Green
} else {
    Write-Host "[!] Broadcast Server NOT detected. Launching in dedicated CMD window..." -ForegroundColor Yellow
    $bCmd = "`"$PythonBin`" `"$ScriptDir\node\broadcast_server.py`" --host 0.0.0.0 --port $bPort --ws-port 9100"
    $bProc = Start-CmdProcess -Title "[Broadcast Server : $bPort]" -Command $bCmd
    Set-Content -Path (Join-Path $RunDir "broadcast_server.pid") -Value $bProc.Id
    
    $attempts = 0
    $up = $false
    while ($attempts -lt 12) {
        Start-Sleep -Milliseconds 500
        if (Test-PortOpen $bHost $bPort) { $up = $true; break }
        $attempts++
    }
    if ($up) {
        Write-Host "[OK] Broadcast Server is running (CMD PID: $($bProc.Id))." -ForegroundColor Green
        Save-ActiveInstance -NodeId "broadcast_server" -Role "BROADCAST" -NodePid $bProc.Id -NodePort $bPort
    } else {
        throw "Failed to launch Broadcast Server on port $bPort."
    }
}

if ($Type -eq "broadcast") { return }

$usedPorts = [System.Collections.Generic.List[int]]::new()

# Launcher: Validator Node & Core
function Launch-ValidatorNode([int]$idx) {
    $nodeId = Get-NodeId "val" $idx
    $corePort = Find-FreePort (50055 + $idx * 2) $usedPorts
    $usedPorts.Add($corePort)
    $nodePort = Find-FreePort (8002 + $idx * 2) $usedPorts
    $usedPorts.Add($nodePort)

    Write-Host "`n>>> Launching VALIDATOR [$nodeId] in dedicated CMD windows (Core: $corePort, Node: $nodePort)..." -ForegroundColor Cyan

    if (-not $BlockchainCoreBin) {
        throw "blockchain_core.exe not found! Please build it first."
    }

    # 1. Open Core CMD Window
    $coreCmd = "`"$BlockchainCoreBin`" --port $corePort"
    $cProc = Start-CmdProcess -Title "[Validator Core $nodeId : $corePort]" -Command $coreCmd
    Set-Content -Path (Join-Path $RunDir "core_$nodeId.pid") -Value $cProc.Id

    Start-Sleep -Milliseconds 600

    # 2. Open Node CMD Window
    $nodeCmd = "`"$PythonBin`" `"$ScriptDir\node\main.py`" --role validator --node-id $nodeId --port $nodePort --core-port $corePort --broadcast-server $Broadcast"
    $nProc = Start-CmdProcess -Title "[Validator Node $nodeId : $nodePort]" -Command $nodeCmd
    Set-Content -Path (Join-Path $RunDir "node_$nodeId.pid") -Value $nProc.Id

    Save-ActiveInstance -NodeId $nodeId -Role "VALIDATOR" -NodePid $nProc.Id -NodePort $nodePort -CorePid $cProc.Id -CorePort $corePort -Extra "core_port=$corePort"
    Write-Host "    [+] Validator online: Node CMD PID $($nProc.Id) | Core CMD PID $($cProc.Id)" -ForegroundColor Green
}

# Launcher: Archive Node & Core
function Launch-ArchiveNode([int]$idx) {
    $nodeId = Get-NodeId "archive" $idx
    $corePort = Find-FreePort (50075 + $idx * 2) $usedPorts
    $usedPorts.Add($corePort)
    $nodePort = Find-FreePort (8010 + $idx * 2) $usedPorts
    $usedPorts.Add($nodePort)

    Write-Host "`n>>> Launching ARCHIVE [$nodeId] in dedicated CMD windows (Core: $corePort, Node: $nodePort)..." -ForegroundColor Cyan

    if (-not $BlockchainCoreBin) {
        throw "blockchain_core.exe not found! Please build it first."
    }

    # 1. Open Core CMD Window
    $coreCmd = "`"$BlockchainCoreBin`" --port $corePort"
    $cProc = Start-CmdProcess -Title "[Archive Core $nodeId : $corePort]" -Command $coreCmd
    Set-Content -Path (Join-Path $RunDir "core_$nodeId.pid") -Value $cProc.Id

    Start-Sleep -Milliseconds 600

    # 2. Open Node CMD Window
    $nodeCmd = "`"$PythonBin`" `"$ScriptDir\node\main.py`" --role archive --node-id $nodeId --port $nodePort --core-port $corePort --broadcast-server $Broadcast"
    $nProc = Start-CmdProcess -Title "[Archive Node $nodeId : $nodePort]" -Command $nodeCmd
    Set-Content -Path (Join-Path $RunDir "node_$nodeId.pid") -Value $nProc.Id

    Save-ActiveInstance -NodeId $nodeId -Role "ARCHIVE" -NodePid $nProc.Id -NodePort $nodePort -CorePid $cProc.Id -CorePort $corePort -Extra "core_port=$corePort"
    Write-Host "    [+] Archive online: Node CMD PID $($nProc.Id) | Core CMD PID $($cProc.Id)" -ForegroundColor Green
}

# Launcher: KSM Node & Core
function Launch-KsmNode([int]$idx) {
    $nodeId = Get-NodeId "ksm" $idx
    $shareIdx = (($idx - 1) % 4) + 1
    $corePort = Find-FreePort (48075 + $idx * 2) $usedPorts
    $usedPorts.Add($corePort)
    $nodePort = Find-FreePort (8031 + $idx * 2) $usedPorts
    $usedPorts.Add($nodePort)
    $storageDir = "chaindata\ksm_$nodeId"

    Write-Host "`n>>> Launching KSM Node [$nodeId] in dedicated CMD windows (Share: $shareIdx/4, Core: $corePort, Node: $nodePort)..." -ForegroundColor Cyan

    if (-not $KsmCoreBin) {
        throw "ksm_core.exe not found! Please build it first."
    }

    # 1. Open KSM Core CMD Window
    $coreCmd = "`"$KsmCoreBin`" --daemon $corePort $nodeId $shareIdx $storageDir"
    $cProc = Start-CmdProcess -Title "[KSM Core $nodeId (Share $shareIdx) : $corePort]" -Command $coreCmd
    Set-Content -Path (Join-Path $RunDir "core_$nodeId.pid") -Value $cProc.Id

    Start-Sleep -Milliseconds 600

    # 2. Open KSM Node CMD Window
    $nodeCmd = "`"$PythonBin`" `"$ScriptDir\node\ksm_node.py`" --node-id $nodeId --share-index $shareIdx --port $nodePort --core-port $corePort --broadcast-server $Broadcast"
    $nProc = Start-CmdProcess -Title "[KSM Node $nodeId (Share $shareIdx) : $nodePort]" -Command $nodeCmd
    Set-Content -Path (Join-Path $RunDir "node_$nodeId.pid") -Value $nProc.Id

    Save-ActiveInstance -NodeId $nodeId -Role "KSM" -NodePid $nProc.Id -NodePort $nodePort -CorePid $cProc.Id -CorePort $corePort -Extra "share=$shareIdx"
    Write-Host "    [+] KSM online: Node CMD PID $($nProc.Id) | Core CMD PID $($cProc.Id)" -ForegroundColor Green
}

# Launcher: Client Node (P2P + WebSocket Gateway)
function Launch-ClientNode([int]$idx) {
    $nodeId = Get-NodeId "client" $idx
    $nodePort = Find-FreePort (8020 + $idx * 2) $usedPorts
    $usedPorts.Add($nodePort)
    $wsPort = Find-FreePort (8765 + $idx * 2) $usedPorts
    $usedPorts.Add($wsPort)

    Write-Host "`n>>> Launching CLIENT Node [$nodeId] in dedicated CMD window (P2P: $nodePort, WS: $wsPort)..." -ForegroundColor Cyan

    # Open Client Node CMD Window
    $nodeCmd = "`"$PythonBin`" `"$ScriptDir\node\client_node.py`" --node-id $nodeId --port $nodePort --ws-port $wsPort --broadcast-server $Broadcast"
    $nProc = Start-CmdProcess -Title "[Client Node $nodeId : P2P $nodePort, WS $wsPort]" -Command $nodeCmd
    Set-Content -Path (Join-Path $RunDir "node_$nodeId.pid") -Value $nProc.Id

    Save-ActiveInstance -NodeId $nodeId -Role "CLIENT" -NodePid $nProc.Id -NodePort $nodePort -CorePid 0 -CorePort $wsPort -Extra "ws_port=$wsPort"
    Write-Host "    [+] Client online: Node CMD PID $($nProc.Id)" -ForegroundColor Green
}

# Launcher: Standalone Hospital KSM Core Daemon
function Launch-HospitalKsmDaemon([string]$hospitalName, [int]$shareIdx, [int]$port) {
    $storageDir = "chaindata\ksm_$hospitalName"
    Write-Host "`n>>> Launching Standalone Hospital KSM Daemon [$hospitalName] on port $port (Share: $shareIdx/4)..." -ForegroundColor Cyan
    if (-not $KsmCoreBin) {
        throw "ksm_core.exe not found! Please build it first."
    }
    $coreCmd = "`"$KsmCoreBin`" --daemon $port $hospitalName $shareIdx $storageDir"
    $cProc = Start-CmdProcess -Title "[KSM Hospital Daemon $hospitalName : $port]" -Command $coreCmd
    Set-Content -Path (Join-Path $RunDir "ksm_daemon_$hospitalName.pid") -Value $cProc.Id
    Save-ActiveInstance -NodeId $hospitalName -Role "KSM_HOSPITAL_DAEMON" -NodePid 0 -NodePort 0 -CorePid $cProc.Id -CorePort $port -Extra "share=$shareIdx"
    Write-Host "    [+] Hospital KSM daemon online: CMD PID $($cProc.Id) on port $port" -ForegroundColor Green
}

switch ($Type) {
    "validator" { 1..$Count | ForEach-Object { Launch-ValidatorNode $_ } }
    "archive"   { 1..$Count | ForEach-Object { Launch-ArchiveNode $_ } }
    "ksm"       { 1..$Count | ForEach-Object { Launch-KsmNode $_ } }
    "client"    { 1..$Count | ForEach-Object { Launch-ClientNode $_ } }
    "all"       {
        Launch-ValidatorNode 1
        1..3 | ForEach-Object { Launch-KsmNode $_ }
        Launch-ClientNode 1
    }
    "cluster"   {
        Write-Host "`n======================================================================" -ForegroundColor Magenta
        Write-Host "  LAUNCHING FULL E-MEDICAL BOOKLET SOVEREIGN CLUSTER (PBFT + KSM + ARCHIVE)" -ForegroundColor Magenta
        Write-Host "======================================================================" -ForegroundColor Magenta
        # 1. 4 Standalone KSM Hospital Core Daemons for Real 3-of-4 Threshold Distribution
        Launch-HospitalKsmDaemon "HOSPITAL_A" 1 9101
        Launch-HospitalKsmDaemon "HOSPITAL_B" 2 9102
        Launch-HospitalKsmDaemon "HOSPITAL_C" 3 9103
        Launch-HospitalKsmDaemon "HOSPITAL_D" 4 9104
        Start-Sleep -Seconds 1

        # 2. 3 Validator Nodes for Full 2f + 1 PBFT Consensus Quorum
        1..3 | ForEach-Object { Launch-ValidatorNode $_ }
        Start-Sleep -Seconds 1

        # 3. 1 Archive Node with Cold Storage Streaming & Pruning
        Launch-ArchiveNode 1
        Start-Sleep -Seconds 1

        # 4. 1 Client Node with WebSocket Gateway (:8765) for Browser Portal
        Launch-ClientNode 1
    }
}

Show-ClusterStatus
Write-Host "[OK] All requested nodes and cores have been launched in separate CMD windows!" -ForegroundColor Green
