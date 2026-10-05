"""Render a pending one-fen probe locally; never send its URL to a QR service."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import qrcode

parser = argparse.ArgumentParser()
parser.add_argument('--order', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if not args.order.is_absolute() or not args.output.is_absolute():
    parser.error('Use absolute local paths')
if args.order.stat().st_size > 65536:
    parser.error('Oversized journal')
order = json.loads(args.order.read_text())
code = order.get('codeUrl', '')
expiry = datetime.fromisoformat(order['expiresAt'].replace('Z', '+00:00'))
if (order.get('amountFen') != '1' or order.get('currency') != 'CNY'
        or order.get('state') != 'NOTPAY' or not code.startswith('weixin://wxpay/')
        or len(code) > 2048 or expiry <= datetime.now(timezone.utc)):
    parser.error('Only a pending, unexpired one-fen diagnostic may be rendered')
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=4)
qr.add_data(code)
qr.make(fit=True)
fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'wb') as f:
    qr.make_image(fill_color='black', back_color='white').save(f, format='PNG')
print('Local one-fen QR saved; checkout URL not logged')
