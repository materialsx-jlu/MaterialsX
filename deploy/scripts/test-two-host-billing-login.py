#!/usr/bin/env python3
"""Run on the edge host; prints status only, never credentials or cookies."""

import base64
import hashlib
import hmac
import http.client
import json
import struct
import sys
import time

with open(sys.argv[1], encoding="utf-8") as source:
    account = json.load(source)
secret = base64.b32decode(account["totpSecret"] + "=" * (-len(account["totpSecret"]) % 8))
step = int(time.time() // 30)
digest = hmac.new(secret, struct.pack(">Q", step), hashlib.sha1).digest()
offset = digest[-1] & 0x0F
otp = str((struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1000000).zfill(6)
headers = {
    "Host": "admin.mx.jouhu.com",
    "Origin": "https://admin.mx.jouhu.com",
    "Content-Type": "application/json",
}
connection = http.client.HTTPConnection("127.0.0.1", 8790, timeout=10)
connection.request("POST", "/api/session/login", json.dumps({
    "email": account["email"],
    "password": account["password"],
    "otp": otp,
}), headers)
response = connection.getresponse()
body = response.read()
print("billing-login-status", response.status)
if response.status != 200:
    raise SystemExit(1)
cookies = [value.split(";", 1)[0] for key, value in response.getheaders() if key.lower() == "set-cookie"]
session = json.loads(body)
if "billing.admin" not in session.get("roles", []):
    raise SystemExit("billing-admin-role-missing")
connection.request("GET", "/api/system", headers={
    "Host": "admin.mx.jouhu.com",
    "Origin": "https://admin.mx.jouhu.com",
    "Cookie": "; ".join(cookies),
})
response = connection.getresponse()
system_body = response.read()
print("billing-system-status", response.status)
if response.status != 200:
    raise SystemExit(1)
print("billing-litellm", json.loads(system_body).get("litellm"))
connection.request("GET", "/api/overview", headers={
    "Host": "admin.mx.jouhu.com",
    "Origin": "https://admin.mx.jouhu.com",
    "Cookie": "; ".join(cookies),
})
response = connection.getresponse()
response.read()
print("billing-overview-status", response.status)
if response.status != 200:
    raise SystemExit(1)
