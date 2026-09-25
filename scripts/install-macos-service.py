#!/usr/bin/env python3
"""Install Chain Trader as a per-user macOS service (no administrator access)."""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

if sys.platform != 'darwin':
    raise SystemExit('This installer is for macOS.')

project = Path(__file__).resolve().parent.parent
node = shutil.which('node')
if not node:
    raise SystemExit('Node.js is required. Install the project dependencies first.')
if not (project / '.next' / 'BUILD_ID').is_file():
    raise SystemExit('Build the app first with npm run build.')

label = 'com.chaintrader.dashboard'
domain = f'gui/{os.getuid()}'
agent_path = Path.home() / 'Library' / 'LaunchAgents' / f'{label}.plist'
logs = Path.home() / 'Library' / 'Logs' / 'ChainTrader'
agent_path.parent.mkdir(parents=True, exist_ok=True)
logs.mkdir(parents=True, exist_ok=True)
configuration = {
    'Label': label,
    'ProgramArguments': [str(Path(node).resolve()), str(project / 'node_modules/next/dist/bin/next'),
                         'start', '--hostname', '127.0.0.1', '--port', '3000'],
    'WorkingDirectory': str(project),
    'EnvironmentVariables': {'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1'},
    'RunAtLoad': True,
    'KeepAlive': True,
    'ThrottleInterval': 10,
    'ExitTimeOut': 15,
    'StandardOutPath': str(logs / 'server.log'),
    'StandardErrorPath': str(logs / 'error.log'),
}
subprocess.run(['launchctl', 'bootout', f'{domain}/{label}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
with agent_path.open('wb') as target:
    plistlib.dump(configuration, target)
agent_path.chmod(0o644)
subprocess.run(['plutil', '-lint', str(agent_path)], check=True)
subprocess.run(['launchctl', 'enable', f'{domain}/{label}'], check=True)
subprocess.run(['launchctl', 'bootstrap', domain, str(agent_path)], check=True)

# Scans and alerts run in the dashboard page, so open it once the server answers
# after login. Several open tabs are safe: only one tab plays alert sounds.
dashboard_url = 'http://127.0.0.1:3000/dashboard'
opener_label = 'com.chaintrader.open-dashboard'
opener_path = Path.home() / 'Library' / 'LaunchAgents' / f'{opener_label}.plist'
browser = '/Applications/Brave Browser.app'
open_command = f'open -a "{browser}" {dashboard_url}' if Path(browser).is_dir() else f'open {dashboard_url}'
opener = {
    'Label': opener_label,
    'ProgramArguments': ['/bin/sh', '-c',
                         f'for i in $(seq 1 90); do curl -fsS -o /dev/null {dashboard_url} && break; sleep 2; done; {open_command}'],
    'RunAtLoad': True,
    'StandardOutPath': str(logs / 'open-dashboard.log'),
    'StandardErrorPath': str(logs / 'open-dashboard.log'),
}
with opener_path.open('wb') as target:
    plistlib.dump(opener, target)
opener_path.chmod(0o644)
subprocess.run(['plutil', '-lint', str(opener_path)], check=True)
# Register for future logins without opening a browser tab right now.
subprocess.run(['launchctl', 'enable', f'{domain}/{opener_label}'], check=True)

print('Chain Trader will start at login and restart if it exits.')
print(f'The dashboard opens in the browser after each login ({opener_path.name}).')
print(f'Dashboard: {dashboard_url}')
print(f'Logs: {logs}')
