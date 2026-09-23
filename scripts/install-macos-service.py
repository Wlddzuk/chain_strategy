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
print('Chain Trader will start at login and restart if it exits.')
print('Dashboard: http://127.0.0.1:3000/dashboard')
print(f'Logs: {logs}')
