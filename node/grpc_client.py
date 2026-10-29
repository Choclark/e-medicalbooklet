import argparse
import socket
import sys


def send_hello(host: str = "127.0.0.1", port: int = 50055, message: str = "Hello from Python Node!") -> None:
    """Send a GetInfo request to the C++ Blockchain Core IPC server and display response."""
    print(f"[+] Connecting to Blockchain Core IPC server at {host}:{port}...")
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(5.0)
            s.connect((host, port))
            payload = f"{message}\n"
            print(f"[->] Sending GetInfo request: \"{message}\"")
            s.sendall(payload.encode("utf-8"))

            data = s.recv(4096)
            if data:
                print(f"[<-] Received IPC Response: {data.decode('utf-8').strip()}")
            else:
                print("[!] Server closed connection without response.")
    except Exception as e:
        print(f"[!] IPC Connection Error: {e}", file=sys.stderr)

def get_node_hostname() -> tuple[str, str]:
    """Retrieve machine hostname and corresponding local IP via socket."""
    hostname = socket.gethostname()
    try:
        ip_address = socket.gethostbyname(hostname)
    except socket.gaierror:
        ip_address = "127.0.0.1"
    return hostname, ip_address
def main() -> None:
    parser = argparse.ArgumentParser(description="Test IPC Client for Blockchain Core")
    parser.add_argument("-p", "--port", type=int, default=50055, help="Blockchain Core IPC port (default: 50055)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Target host IP (default: 127.0.0.1)")
    parser.add_argument("-m", "--message", type=str, default="Hello from Python Node!", help="Message to send")
    args = parser.parse_args()
    hostname, local_ip = get_node_hostname()
    print(f"[+] Node Hostname: {hostname} (IP: {local_ip})")

    send_hello(local_ip, args.port, args.message)


if __name__ == "__main__":
    main()
