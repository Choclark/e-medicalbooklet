#!/usr/bin/env bash
# ==============================================================================
# E-MEDICAL BOOKLET: MULTI-NODE & CORE ORCHESTRATION LAUNCHER
# ==============================================================================
# Features:
#   1. Dynamic Unused Port Discovery (skips occupied ports & Windows reserved ranges)
#   2. Automatic Broadcast & Discovery Server Healthcheck and Auto-Launch
#   3. Dynamic C++ Core (blockchain_core / ksm_core) & Python Node Spawning
#   4. Configurable Node Type (validator, ksm, client, archive, or cluster/all)
#   5. Configurable Quantity of Nodes and Cores to Launch
#   6. Isolated Chaindata and Dedicated Log Files per Instance
#   7. State Management with Tracking for Clean Shutdown via ./stop_nodes.sh
# ==============================================================================

set -e

export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

# Path normalizer for Windows Git Bash / Cygwin / Linux / macOS
to_native_path() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -m "$1"
    else
        echo "$1"
    fi
}

RAW_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$(to_native_path "$RAW_SCRIPT_DIR")"
cd "$RAW_SCRIPT_DIR"

RUN_DIR="$SCRIPT_DIR/.run"
LOGS_DIR="$SCRIPT_DIR/logs"
STATE_FILE="$RUN_DIR/active_nodes.json"

mkdir -p "$RAW_SCRIPT_DIR/.run" "$RAW_SCRIPT_DIR/logs"

# ------------------------------------------------------------------------------
# Terminal Colors
# ------------------------------------------------------------------------------
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ------------------------------------------------------------------------------
# Locate Python Virtual Environment
# ------------------------------------------------------------------------------
detect_python() {
    if [ -f "$RAW_SCRIPT_DIR/node/.venv/Scripts/python.exe" ]; then
        to_native_path "$RAW_SCRIPT_DIR/node/.venv/Scripts/python.exe"
    elif [ -f "$RAW_SCRIPT_DIR/node/.venv/bin/python" ]; then
        to_native_path "$RAW_SCRIPT_DIR/node/.venv/bin/python"
    elif command -v python3 >/dev/null 2>&1; then
        echo "python3"
    elif command -v python >/dev/null 2>&1; then
        echo "python"
    else
        echo -e "${RED}[!] Error: Python interpreter not found!${NC}" >&2
        exit 1
    fi
}

PYTHON_BIN="$(detect_python)"

# ------------------------------------------------------------------------------
# Locate C++ Core Binaries
# ------------------------------------------------------------------------------
detect_blockchain_core() {
    local candidates=(
        "$RAW_SCRIPT_DIR/build/Debug/blockchain_core.exe"
        "$RAW_SCRIPT_DIR/blockchain-core/build/Debug/blockchain_core.exe"
        "$RAW_SCRIPT_DIR/build/Release/blockchain_core.exe"
        "$RAW_SCRIPT_DIR/build/blockchain_core"
        "$RAW_SCRIPT_DIR/blockchain-core/build/blockchain_core"
    )
    for c in "${candidates[@]}"; do
        if [ -f "$c" ]; then
            to_native_path "$c"
            return 0
        fi
    done
    echo ""
}

detect_ksm_core() {
    local candidates=(
        "$RAW_SCRIPT_DIR/build/Debug/ksm_core.exe"
        "$RAW_SCRIPT_DIR/ksm-core/build/Debug/ksm_core.exe"
        "$RAW_SCRIPT_DIR/build-ksm/Debug/ksm_core.exe"
        "$RAW_SCRIPT_DIR/build/Release/ksm_core.exe"
        "$RAW_SCRIPT_DIR/build/ksm_core"
        "$RAW_SCRIPT_DIR/ksm-core/build/ksm_core"
    )
    for c in "${candidates[@]}"; do
        if [ -f "$c" ]; then
            to_native_path "$c"
            return 0
        fi
    done
    echo ""
}

BLOCKCHAIN_CORE_BIN="$(detect_blockchain_core)"
KSM_CORE_BIN="$(detect_ksm_core)"

# ------------------------------------------------------------------------------
# Port Discovery & Verification via Python Socket Engine
# ------------------------------------------------------------------------------
is_port_open() {
    local host="$1"
    local port="$2"
    "$PYTHON_BIN" -c "
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.6)
try:
    s.connect(('$host', int($port)))
    s.close()
    sys.exit(0)
except Exception:
    sys.exit(1)
" >/dev/null 2>&1
}

find_free_ports() {
    local start_port="$1"
    local count="${2:-1}"
    local exclude="${3:-}"
    "$PYTHON_BIN" -c "
import socket, sys

exclude_set = set()
if '$exclude':
    exclude_set = {int(x) for x in '$exclude'.split(',') if x.strip()}

def is_bindable(port):
    if port in exclude_set:
        return False
    # Avoid Windows Hyper-V / WSL dynamic exclusion range (50060 - 50159)
    if 50060 <= port <= 50159:
        return False
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('0.0.0.0', port))
        s.close()
        return True
    except Exception:
        return False

start = int($start_port)
found = []
p = start
while len(found) < int($count) and p < 65000:
    if is_bindable(p):
        found.append(p)
    p += 1

if len(found) < int($count):
    sys.exit(1)

print(' '.join(str(x) for x in found))
"
}

# ------------------------------------------------------------------------------
# Broadcast Server Healthcheck and Auto-Launch
# ------------------------------------------------------------------------------
ensure_broadcast_server() {
    local b_host="${1:-127.0.0.1}"
    local b_port="${2:-9099}"

    echo -e "${CYAN}----------------------------------------------------------------------${NC}"
    echo -e "${CYAN}[*] Step 1: Checking Broadcast & Discovery Server (${b_host}:${b_port})...${NC}"

    if is_port_open "$b_host" "$b_port"; then
        echo -e "${GREEN}[✓] Broadcast Server is already running and active on ${b_host}:${b_port}.${NC}"
    else
        echo -e "${YELLOW}[!] Broadcast Server is NOT running. Launching now...${NC}"
        
        local free_check
        free_check=$(find_free_ports "$b_port" 1 "") || {
            echo -e "${RED}[!] Port $b_port cannot be bound. Searching for alternative broadcast port...${NC}"
            b_port=$(find_free_ports 9099 1 "")
        }

        local b_log="$LOGS_DIR/broadcast_server.log"
        local b_script="$SCRIPT_DIR/node/broadcast_server.py"

        nohup "$PYTHON_BIN" "$b_script" \
            --host "0.0.0.0" \
            --port "$b_port" \
            --ws-port 9100 > "$RAW_SCRIPT_DIR/logs/broadcast_server.log" 2>&1 &
        local b_pid=$!

        echo "$b_pid" > "$RAW_SCRIPT_DIR/.run/broadcast_server.pid"
        echo -e "${BLUE}    Started Broadcast Server (PID: $b_pid, Port: $b_port)${NC}"

        # Wait for socket to become active (up to 6 seconds)
        local attempts=0
        local up=0
        while [ $attempts -lt 12 ]; do
            sleep 0.5
            if is_port_open "$b_host" "$b_port"; then
                up=1
                break
            fi
            attempts=$((attempts + 1))
        done

        if [ $up -eq 1 ]; then
            echo -e "${GREEN}[✓] Broadcast Server is now up and accepting connections!${NC}"
            save_active_instance "broadcast_server" "BROADCAST_SERVER" "$b_pid" "$b_port" 0 0 "$b_log"
        else
            echo -e "${RED}[!] Failed to connect to Broadcast Server within 6 seconds. Check $b_log${NC}"
            tail -n 20 "$RAW_SCRIPT_DIR/logs/broadcast_server.log" 2>/dev/null || true
            exit 1
        fi
    fi
    BROADCAST_HOST="$b_host"
    BROADCAST_PORT="$b_port"
}

# ------------------------------------------------------------------------------
# JSON State Management
# ------------------------------------------------------------------------------
save_active_instance() {
    local node_id="$1"
    local role="$2"
    local node_pid="$3"
    local node_port="$4"
    local core_pid="${5:-0}"
    local core_port="${6:-0}"
    local log_file="$7"
    local core_log="${8:-}"
    local extra="${9:-}"

    "$PYTHON_BIN" -c "
import json, os, time

path = r'$STATE_FILE'
os.makedirs(os.path.dirname(path), exist_ok=True)
data = {'instances': []}
if os.path.exists(path):
    try:
        with open(path, 'r') as f:
            data = json.load(f)
    except Exception:
        data = {'instances': []}

record = {
    'node_id': '$node_id',
    'role': '$role',
    'node_pid': int('$node_pid'),
    'node_port': int('$node_port'),
    'core_pid': int('$core_pid'),
    'core_port': int('$core_port'),
    'log_file': r'$log_file',
    'core_log': r'$core_log',
    'extra': '$extra',
    'started_at': time.strftime('%Y-%m-%d %H:%M:%S')
}
data['instances'].append(record)
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
"
}

# ------------------------------------------------------------------------------
# Node Launchers
# ------------------------------------------------------------------------------

launch_validator() {
    local idx="$1"
    local node_id="val-$(printf "%02d" "$idx")"
    local data_dir="$SCRIPT_DIR/chaindata/$node_id"

    echo -e "${CYAN}>>> Preparing VALIDATOR [$node_id] (Node + Blockchain Core)...${NC}"

    if [ -z "$BLOCKCHAIN_CORE_BIN" ]; then
        echo -e "${RED}[!] Error: blockchain_core.exe not found! Please build it first.${NC}"
        exit 1
    fi

    local core_port
    core_port=$(find_free_ports $((48055 + idx * 2)) 1 "$USED_PORTS")
    USED_PORTS="${USED_PORTS:+$USED_PORTS,}$core_port"

    local node_port
    node_port=$(find_free_ports $((8002 + idx * 2)) 1 "$USED_PORTS")
    USED_PORTS="${USED_PORTS:+$USED_PORTS,}$node_port"

    echo -e "    * Allocated Ports -> Core IPC: ${BOLD}${GREEN}$core_port${NC} | Node P2P: ${BOLD}${GREEN}$node_port${NC}"

    local core_log="$LOGS_DIR/core_${node_id}.log"
    mkdir -p "$RAW_SCRIPT_DIR/chaindata/$node_id"
    nohup "$BLOCKCHAIN_CORE_BIN" \
        --port "$core_port" \
        --host "0.0.0.0" \
        --node-id "$node_id" \
        --chain-id "$CHAIN_ID" \
        --data-dir "$data_dir" > "$RAW_SCRIPT_DIR/logs/core_${node_id}.log" 2>&1 &
    local core_pid=$!
    echo "$core_pid" > "$RAW_SCRIPT_DIR/.run/core_${node_id}.pid"
    echo -e "${BLUE}    [+] Started Blockchain Core C++ daemon (PID: $core_pid, Port: $core_port)${NC}"

    sleep 0.8

    local node_log="$LOGS_DIR/node_${node_id}.log"
    nohup "$PYTHON_BIN" "$SCRIPT_DIR/node/main.py" \
        --role "validator" \
        --node-id "$node_id" \
        --port "$node_port" \
        --core-port "$core_port" \
        --core-host "127.0.0.1" \
        --chain-id "$CHAIN_ID" \
        --broadcast-server "${BROADCAST_HOST}:${BROADCAST_PORT}" > "$RAW_SCRIPT_DIR/logs/node_${node_id}.log" 2>&1 &
    local node_pid=$!
    echo "$node_pid" > "$RAW_SCRIPT_DIR/.run/node_${node_id}.pid"
    echo -e "${BLUE}    [+] Started Validator Node Python runner (PID: $node_pid, Port: $node_port)${NC}"

    save_active_instance "$node_id" "VALIDATOR" "$node_pid" "$node_port" "$core_pid" "$core_port" "$node_log" "$core_log" "chain_id=$CHAIN_ID"
}

launch_archive() {
    local idx="$1"
    local node_id="archive-$(printf "%02d" "$idx")"
    local data_dir="$SCRIPT_DIR/chaindata/$node_id"

    echo -e "${CYAN}>>> Preparing ARCHIVE Node [$node_id] (Node + Blockchain Core)...${NC}"

    if [ -z "$BLOCKCHAIN_CORE_BIN" ]; then
        echo -e "${RED}[!] Error: blockchain_core.exe not found! Please build it first.${NC}"
        exit 1
    fi

    local core_port
    core_port=$(find_free_ports $((48060 + idx * 2)) 1 "$USED_PORTS")
    USED_PORTS="${USED_PORTS:+$USED_PORTS,}$core_port"

    local node_port
    node_port=$(find_free_ports $((8010 + idx * 2)) 1 "$USED_PORTS")
    USED_PORTS="${USED_PORTS:+$USED_PORTS,}$node_port"

    echo -e "    * Allocated Ports -> Core IPC: ${BOLD}${GREEN}$core_port${NC} | Node P2P: ${BOLD}${GREEN}$node_port${NC}"

    local core_log="$LOGS_DIR/core_${node_id}.log"
    mkdir -p "$RAW_SCRIPT_DIR/chaindata/$node_id"
    nohup "$BLOCKCHAIN_CORE_BIN" \
        --port "$core_port" \
        --host "0.0.0.0" \
        --node-id "$node_id" \
        --chain-id "$CHAIN_ID" \
        --data-dir "$data_dir" > "$RAW_SCRIPT_DIR/logs/core_${node_id}.log" 2>&1 &
    local core_pid=$!
    echo "$core_pid" > "$RAW_SCRIPT_DIR/.run/core_${node_id}.pid"

    sleep 0.8

    local node_log="$LOGS_DIR/node_${node_id}.log"
    nohup "$PYTHON_BIN" "$SCRIPT_DIR/node/main.py" \
        --role "archive" \
        --node-id "$node_id" \
        --port "$node_port" \
        --core-port "$core_port" \
        --core-host "127.0.0.1" \
        --chain-id "$CHAIN_ID" \
        --broadcast-server "${BROADCAST_HOST}:${BROADCAST_PORT}" > "$RAW_SCRIPT_DIR/logs/node_${node_id}.log" 2>&1 &
    local node_pid=$!
    echo "$node_pid" > "$RAW_SCRIPT_DIR/.run/node_${node_id}.pid"

    save_active_instance "$node_id" "ARCHIVE" "$node_pid" "$node_port" "$core_pid" "$core_port" "$node_log" "$core_log" "chain_id=$CHAIN_ID"
}

launch_ksm() {
    local idx="$1"
    local node_id="ksm-$(printf "%02d" "$idx")"
    local share_index=$(( ((idx - 1) % 4) + 1 ))
    local storage_dir="$SCRIPT_DIR/chaindata/ksm_${node_id}"

    echo -e "${CYAN}>>> Preparing KSM Node [$node_id] (Share Coordinate: $share_index / 4)...${NC}"

    if [ -z "$KSM_CORE_BIN" ]; then
        echo -e "${RED}[!] Error: ksm_core.exe not found! Please build it first.${NC}"
        exit 1
    fi

    local core_port
    core_port=$(find_free_ports $((48075 + idx * 2)) 1 "$USED_PORTS")
    USED_PORTS="${USED_PORTS:+$USED_PORTS,}$core_port"

    local node_port
    node_port=$(find_free_ports $((8031 + idx * 2)) 1 "$USED_PORTS")
    USED_PORTS="${USED_PORTS:+$USED_PORTS,}$node_port"

    echo -e "    * Allocated Ports -> KSM Core IPC: ${BOLD}${GREEN}$core_port${NC} | KSM P2P: ${BOLD}${GREEN}$node_port${NC} (Share: $share_index)"

    local core_log="$LOGS_DIR/core_${node_id}.log"
    mkdir -p "$RAW_SCRIPT_DIR/chaindata/ksm_${node_id}"
    nohup "$KSM_CORE_BIN" \
        --daemon "$core_port" "$node_id" "$share_index" "$storage_dir" > "$RAW_SCRIPT_DIR/logs/core_${node_id}.log" 2>&1 &
    local core_pid=$!
    echo "$core_pid" > "$RAW_SCRIPT_DIR/.run/core_${node_id}.pid"
    echo -e "${BLUE}    [+] Started KSM Core C++ daemon (PID: $core_pid, Port: $core_port)${NC}"

    sleep 0.8

    local node_log="$LOGS_DIR/node_${node_id}.log"
    nohup "$PYTHON_BIN" "$SCRIPT_DIR/node/ksm_node.py" \
        --node-id "$node_id" \
        --share-index "$share_index" \
        --port "$node_port" \
        --core-port "$core_port" \
        --core-host "127.0.0.1" \
        --broadcast-server "${BROADCAST_HOST}:${BROADCAST_PORT}" > "$RAW_SCRIPT_DIR/logs/node_${node_id}.log" 2>&1 &
    local node_pid=$!
    echo "$node_pid" > "$RAW_SCRIPT_DIR/.run/node_${node_id}.pid"
    echo -e "${BLUE}    [+] Started KSM Node Python runner (PID: $node_pid, Port: $node_port)${NC}"

    save_active_instance "$node_id" "KSM" "$node_pid" "$node_port" "$core_pid" "$core_port" "$node_log" "$core_log" "share_index=$share_index"
}

launch_client() {
    local idx="$1"
    local node_id="client-$(printf "%02d" "$idx")"

    echo -e "${CYAN}>>> Preparing CLIENT Gateway [$node_id] (P2P + WebSockets for Web Apps)...${NC}"

    local node_port
    node_port=$(find_free_ports $((8020 + idx * 2)) 1 "$USED_PORTS")
    USED_PORTS="${USED_PORTS:+$USED_PORTS,}$node_port"

    local ws_port
    ws_port=$(find_free_ports $((8765 + idx * 2)) 1 "$USED_PORTS")
    USED_PORTS="${USED_PORTS:+$USED_PORTS,}$ws_port"

    echo -e "    * Allocated Ports -> P2P Port: ${BOLD}${GREEN}$node_port${NC} | WebSocket Port: ${BOLD}${GREEN}$ws_port${NC}"

    local node_log="$LOGS_DIR/node_${node_id}.log"
    nohup "$PYTHON_BIN" "$SCRIPT_DIR/node/client_node.py" \
        --node-id "$node_id" \
        --port "$node_port" \
        --ws-port "$ws_port" \
        --host "0.0.0.0" \
        --broadcast-server "${BROADCAST_HOST}:${BROADCAST_PORT}" > "$RAW_SCRIPT_DIR/logs/node_${node_id}.log" 2>&1 &
    local node_pid=$!
    echo "$node_pid" > "$RAW_SCRIPT_DIR/.run/node_${node_id}.pid"
    echo -e "${BLUE}    [+] Started Client Node Gateway (PID: $node_pid, P2P: $node_port, WS: $ws_port)${NC}"

    save_active_instance "$node_id" "CLIENT" "$node_pid" "$node_port" 0 "$ws_port" "$node_log" "" "ws_port=$ws_port"
}

# ------------------------------------------------------------------------------
# Status Reporter
# ------------------------------------------------------------------------------
show_status() {
    echo -e "\n${BOLD}${BLUE}======================================================================${NC}"
    echo -e "${BOLD}${BLUE}               ACTIVE E-MEDICAL BOOKLET INSTANCES                     ${NC}"
    echo -e "${BOLD}${BLUE}======================================================================${NC}"
    "$PYTHON_BIN" -c "
import json, os, socket

path = r'$STATE_FILE'
if not os.path.exists(path):
    print('No active instances recorded in ' + path)
    exit(0)

try:
    with open(path, 'r') as f:
        data = json.load(f)
except Exception as e:
    print('Error loading state:', e)
    exit(1)

instances = data.get('instances', [])
if not instances:
    print('No running instances.')
    exit(0)

def is_alive(port, pid):
    if port > 0:
        for host in ('127.0.0.1', 'localhost'):
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(0.4)
                s.connect((host, port))
                s.close()
                return True
            except Exception:
                pass
    if pid > 0:
        try:
            if os.name == 'nt':
                res = subprocess.run(['tasklist', '/FI', f'PID eq {pid}'], capture_output=True, text=True)
                return str(pid) in res.stdout
            else:
                os.kill(pid, 0)
                return True
        except Exception:
            pass
    return False

fmt = '{:<16} {:<12} {:<10} {:<11} {:<11} {:<9} {:<12}'
print(fmt.format('NODE ID', 'ROLE', 'NODE PID', 'NODE PORT', 'CORE PORT', 'STATUS', 'EXTRA'))
print('-' * 84)
for inst in instances:
    nid = inst.get('node_id', '-')
    role = inst.get('role', '-')
    npid = int(inst.get('node_pid', 0))
    nport = inst.get('node_port', 0)
    cport = inst.get('core_port', 0)
    extra = inst.get('extra', '')
    
    alive = is_alive(nport, npid)
    st = 'RUNNING' if alive else 'STOPPED'
    cport_str = str(cport) if cport > 0 else 'N/A'
    print(fmt.format(nid, role, str(npid), str(nport), cport_str, st, extra))
"
    echo -e "${BOLD}${BLUE}======================================================================${NC}\n"
}

# ------------------------------------------------------------------------------
# Usage & Help Screen
# ------------------------------------------------------------------------------
show_help() {
    echo -e "${BOLD}E-Medical Booklet Multi-Node & Core Launcher${NC}"
    echo -e ""
    echo -e "${BOLD}USAGE:${NC}"
    echo -e "  ./launch_nodes.sh [node_type] [quantity] [options]"
    echo -e ""
    echo -e "${BOLD}NODE TYPES:${NC}"
    echo -e "  ${GREEN}validator${NC}       Launch Validator node(s) + C++ Blockchain Core(s)"
    echo -e "  ${GREEN}ksm${NC}             Launch KSM node(s) + C++ KSM Core(s) (1-4 Threshold Shares)"
    echo -e "  ${GREEN}client${NC}          Launch Client node(s) with WebSocket gateway for PulseClinic"
    echo -e "  ${GREEN}archive${NC}         Launch Archive node(s) + C++ Blockchain Core(s)"
    echo -e "  ${GREEN}all | cluster${NC}   Launch full test cluster (1 Validator + 3 KSM + 1 Client)"
    echo -e "  ${GREEN}broadcast${NC}       Launch only the central Broadcast & Discovery Server"
    echo -e "  ${GREEN}status${NC}          Display status table of all active nodes, ports, and PIDs"
    echo -e ""
    echo -e "${BOLD}OPTIONS:${NC}"
    echo -e "  -t, --type <role>         Node type (validator, ksm, client, archive, all)"
    echo -e "  -n, --count <num>         Number of nodes and cores to launch (default: 1)"
    echo -e "  -c, --chain-id <id>       Blockchain Channel ID (default: 0)"
    echo -e "  -b, --broadcast <host:p>  Broadcast Server address (default: 127.0.0.1:9099)"
    echo -e "  -s, --status              Check status of all running nodes and exit"
    echo -e "  -h, --help                Show this help manual"
    echo -e ""
    echo -e "${BOLD}EXAMPLES:${NC}"
    echo -e "  ./launch_nodes.sh validator 2        # Launch 2 Validators + 2 Blockchain Cores"
    echo -e "  ./launch_nodes.sh ksm 4              # Launch 4 KSM nodes (coordinates 1..4) + 4 KSM Cores"
    echo -e "  ./launch_nodes.sh client 1           # Launch 1 Client Gateway (P2P + WebSocket)"
    echo -e "  ./launch_nodes.sh all                # Launch complete network cluster"
    echo -e "  ./launch_nodes.sh status             # View running topology"
    echo -e "  ./stop_nodes.sh                      # Cleanly terminate all active nodes"
    echo -e ""
}

# ------------------------------------------------------------------------------
# Argument Parsing
# ------------------------------------------------------------------------------
NODE_TYPE=""
COUNT=1
CHAIN_ID=0
BROADCAST_ADDR="127.0.0.1:9099"
USED_PORTS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help|help)
            show_help
            exit 0
            ;;
        -s|--status|status)
            show_status
            exit 0
            ;;
        -t|--type)
            NODE_TYPE="$2"
            shift 2
            ;;
        -n|--count)
            COUNT="$2"
            shift 2
            ;;
        -c|--chain-id)
            CHAIN_ID="$2"
            shift 2
            ;;
        -b|--broadcast)
            BROADCAST_ADDR="$2"
            shift 2
            ;;
        validator|ksm|client|archive|all|cluster|broadcast)
            NODE_TYPE="$1"
            shift
            if [[ $# -gt 0 && "$1" =~ ^[0-9]+$ ]]; then
                COUNT="$1"
                shift
            fi
            ;;
        *)
            if [[ "$1" =~ ^[0-9]+$ ]]; then
                COUNT="$1"
                shift
            else
                echo -e "${RED}[!] Unknown argument: $1${NC}"
                show_help
                exit 1
            fi
            ;;
    esac
done

if [ -z "$NODE_TYPE" ]; then
    NODE_TYPE="validator"
fi

# ------------------------------------------------------------------------------
# Execution Banner
# ------------------------------------------------------------------------------
echo -e "${BOLD}${BLUE}======================================================================${NC}"
echo -e "${BOLD}${BLUE}  E-MEDICAL BOOKLET: AUTOMATED ORCHESTRATION LAUNCHER                 ${NC}"
echo -e "${BOLD}${BLUE}======================================================================${NC}"
echo -e "  - Requested Role:      ${BOLD}${GREEN}${NODE_TYPE}${NC}"
echo -e "  - Instance Count:      ${BOLD}${GREEN}${COUNT}${NC}"
echo -e "  - Python Interpreter:  $PYTHON_BIN"
echo -e "  - Blockchain Core:     ${BLOCKCHAIN_CORE_BIN:-Not Detected (Not needed for client)}"
echo -e "  - KSM Core Engine:     ${KSM_CORE_BIN:-Not Detected (Not needed for validator/client)}"
echo -e "  - Logs Directory:      $LOGS_DIR"
echo -e "  - Runtime Directory:   $RUN_DIR"
echo -e "${BOLD}${BLUE}======================================================================${NC}\n"

# ------------------------------------------------------------------------------
# Step 1: Broadcast Server
# ------------------------------------------------------------------------------
B_HOST="${BROADCAST_ADDR%:*}"
B_PORT="${BROADCAST_ADDR#*:}"

ensure_broadcast_server "$B_HOST" "$B_PORT"

if [ "$NODE_TYPE" == "broadcast" ]; then
    echo -e "\n${GREEN}[✓] Broadcast Server launched. Exiting as requested.${NC}"
    exit 0
fi

# ------------------------------------------------------------------------------
# Step 2: Launch Requested Nodes & Cores
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}----------------------------------------------------------------------${NC}"
echo -e "${CYAN}[*] Step 2: Fetching Unused Ports & Spawning ${COUNT}x [${NODE_TYPE}]...${NC}"
echo -e "${CYAN}----------------------------------------------------------------------${NC}"

case "$NODE_TYPE" in
    validator)
        for i in $(seq 1 "$COUNT"); do
            launch_validator "$i"
            echo ""
        done
        ;;
    archive)
        for i in $(seq 1 "$COUNT"); do
            launch_archive "$i"
            echo ""
        done
        ;;
    ksm)
        for i in $(seq 1 "$COUNT"); do
            launch_ksm "$i"
            echo ""
        done
        ;;
    client)
        for i in $(seq 1 "$COUNT"); do
            launch_client "$i"
            echo ""
        done
        ;;
    all|cluster)
        echo -e "${BOLD}${YELLOW}>>> Launching Complete Demonstration Cluster (1 Val + 3 KSM + 1 Client)...${NC}\n"
        launch_validator 1
        echo ""
        for k in 1 2 3; do
            launch_ksm "$k"
            echo ""
        done
        launch_client 1
        echo ""
        ;;
    *)
        echo -e "${RED}[!] Unsupported node type: $NODE_TYPE${NC}"
        show_help
        exit 1
        ;;
esac

# ------------------------------------------------------------------------------
# Step 3: Final Status Table
# ------------------------------------------------------------------------------
sleep 1.2
show_status

echo -e "${GREEN}${BOLD}[✓] All requested nodes and cores have been successfully launched!${NC}"
echo -e "    * Tail logs with:  ${CYAN}tail -f logs/*.log${NC}"
echo -e "    * Check status:    ${CYAN}./launch_nodes.sh status${NC}"
echo -e "    * Stop cluster:    ${CYAN}./stop_nodes.sh${NC}\n"
