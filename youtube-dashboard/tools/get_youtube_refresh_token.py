#!/usr/bin/env python3
"""Issue a YouTube Analytics OAuth refresh token using a loopback redirect."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer


AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPES = (
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
)


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    code: str | None = None
    error: str | None = None
    expected_state: str = ""

    def do_GET(self) -> None:  # noqa: N802
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        state = query.get("state", [""])[0]
        if state != self.expected_state:
            type(self).error = "state_mismatch"
        else:
            type(self).code = query.get("code", [None])[0]
            type(self).error = query.get("error", [None])[0]

        ok = bool(type(self).code) and not type(self).error
        body = (
            "YouTube Analytics の認証が完了しました。このタブを閉じてください。"
            if ok
            else "認証を完了できませんでした。ターミナルの表示を確認してください。"
        ).encode("utf-8")
        self.send_response(200 if ok else 400)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str, verifier: str) -> dict:
    payload = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    ).encode("ascii")
    request = urllib.request.Request(
        TOKEN_URL,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    client_id = os.environ.get("YOUTUBE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        print("YOUTUBE_CLIENT_ID と YOUTUBE_CLIENT_SECRET を設定してください。", file=sys.stderr)
        return 2

    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    OAuthCallbackHandler.expected_state = state

    server = HTTPServer(("127.0.0.1", 0), OAuthCallbackHandler)
    redirect_uri = f"http://127.0.0.1:{server.server_port}/"
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "select_account consent",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    login_hint = os.environ.get("YOUTUBE_LOGIN_HINT", "").strip()
    if login_hint:
        params["login_hint"] = login_hint
    authorization_url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
    print(f"AUTHORIZATION_URL={authorization_url}", flush=True)
    if not args.no_browser:
        webbrowser.open(authorization_url)

    server.handle_request()
    server.server_close()
    if OAuthCallbackHandler.error or not OAuthCallbackHandler.code:
        print(f"OAuth authorization failed: {OAuthCallbackHandler.error or 'missing_code'}", file=sys.stderr)
        return 3

    tokens = exchange_code(client_id, client_secret, OAuthCallbackHandler.code, redirect_uri, verifier)
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        print("リフレッシュトークンが返りませんでした。prompt=consent で再承認してください。", file=sys.stderr)
        return 4

    print(f"YOUTUBE_REFRESH_TOKEN={refresh_token}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
