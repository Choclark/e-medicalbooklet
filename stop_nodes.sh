#!/usr/bin/env bash
# ==============================================================================
# E-MEDICAL BOOKLET: CLEAN INSTANCE TERMINATOR (SHUTDOWN)
# ==============================================================================
# Cleanly terminates all nodes, C++ cores, and broadcast servers launched by
# launch_nodes.sh, freeing up all ports and clearing stale PID files.
# ==============================================================================

set -e

export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

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
STATE_FILE="$RUN_DIR/active_nodes.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${RED}======================================================================${NC}"
echo -e "${BOLD}${RED}       STOPPING E-MEDICAL BOOKLET NODES & BLOCKCHAIN CORES            ${NC}"
echo -e "${BOLD}${RED}======================================================================${NC}"

if [ -f "$RAW_SCRIPT_DIR/node/.venv/Scripts/python.exe" ]; then
    PYTHON_BIN="$(to_native_path "$RAW_SCRIPT_DIR/node/.venv/Scripts/python.exe")"
elif [ -f "$RAW_SCRIPT_DIR/node/.venv/bin/python" ]; then
    PYTHON_BIN="$(to_native_path "$RAW_SCRIPT_DIR/node/.venv/bin/python")"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
else
    PYTHON_BIN="python"
fi

"$PYTHON_BIN" -c "
import json, os, signal, subprocess, sys

state_path = r'$STATE_FILE'
pids_to_kill = set()
ports_to_free = set()

if os.path.exists(state_path):
    try:
        with open(state_path, 'r') as f:
            data = json.load(f)
            for inst in data.get('instances', []):
                npid = inst.get('node_pid', 0)
                cpid = inst.get('core_pid', 0)
                nport = inst.get('node_port', 0)
                cport = inst.get('core_port', 0)
                if npid > 0: pids_to_kill.add(npid)
                if cpid > 0: pids_to_kill.add(cpid)
                if nport > 0: ports_to_free.add(nport)
                if cport > 0: ports_to_free.add(cport)
    except Exception as ex:
        print('Warning reading state file:', ex)

run_dir = r'$RUN_DIR'
if os.path.exists(run_dir):
    for fname in os.listdir(run_dir):
        if fname.endswith('.pid'):
            try:
                with open(os.path.join(run_dir, fname), 'r') as pf:
                    pid = int(pf.read().strip())
                    if pid > 0: pids_to_kill.add(pid)
            except Exception:
                pass

def kill_pid(pid):
    if pid <= 0: return
    try:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.kill(pid, signal.SIGKILL)
    except Exception:
        pass

def kill_by_port(port):
    if port <= 0: return
    try:
        if os.name == 'nt':
            # Fast netstat inspection without slow powershell invocation
            out = subprocess.check_output(['netstat', '-ano', '-p', 'tcp'], text=True, errors='ignore')
            target_str = f':{port} '
            for line in out.splitlines():
                if target_str in line and 'LISTENING' in line:
                    parts = line.strip().split()
                    if parts and parts[-1].isdigit():
                        pid = int(parts[-1])
                        if pid > 0:
                            kill_pid(pid)
        else:
            subprocess.run(['fuser', '-k', f'{port}/tcp'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

print(f'[*] Terminating {len(pids_to_kill)} recorded process IDs...')
for pid in sorted(pids_to_kill):
    print(f'    [-] Killing PID {pid}')
    kill_pid(pid)

print(f'[*] Verifying and freeing {len(ports_to_free)} network ports...')
for port in sorted(ports_to_free):
    kill_by_port(port)

if os.path.exists(state_path):
    with open(state_path, 'w') as f:
        json.dump({'instances': []}, f, indent=2)

print('[OK] All recorded processes stopped.')
"

rm -f "$RAW_SCRIPT_DIR/.run"/*.pid 2>/dev/null || true

echo -e "\n${GREEN}[✓] E-Medical Booklet instances successfully stopped and ports freed.${NC}\n"
