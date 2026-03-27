"""
Run the Platform API without the stdlib `platform` naming conflict.

Usage:
    py platform/run.py
    py platform/run.py --port 8001
    py platform/run.py --reload
"""
import sys
import argparse

# Remove CWD / virality from sys.path so stdlib `platform` is found first,
# then add this package's own directory so `services.api.main` is importable.
_this_dir = __file__.replace('\\', '/').rsplit('/', 1)[0]  # .../virality/platform
sys.path = [p for p in sys.path if p and 'virality' not in p.lower()] + [_this_dir]

import uvicorn  # noqa: E402 — import after path fix

parser = argparse.ArgumentParser()
parser.add_argument('--host',   default='127.0.0.1')
parser.add_argument('--port',   default=8000, type=int)
parser.add_argument('--reload', action='store_true')
args = parser.parse_args()

uvicorn.run('services.api.main:app', host=args.host, port=args.port, reload=args.reload)
