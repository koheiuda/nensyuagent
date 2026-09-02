#!/usr/bin/env python3
"""Run owner-channel OAuth and update Vercel without printing credentials."""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import urllib.parse
import urllib.error
from http.server import HTTPServer

import get_youtube_refresh_token as oauth


CLIENT_ID = "679007527174-1c91bf39g7eh939gs1lgb1u5sdmcuaqt.apps.googleusercontent.com"
CHANNEL_ID = "UCwrivK-bKlDu6ZJzC01GPBw"
TEMP_DIR = Path(os.environ.get("TEMP", ""))
SECRET_PATH = TEMP_DIR / "yt-oauth-secret.tmp"
URL_PATH = TEMP_DIR / "yt-oauth-url.tmp"


def set_vercel_secret(name: str, value: str) -> None:
    completed = subprocess.run(
        ["vercel.cmd", "env", "add", name, "production", "--force", "--sensitive", "--yes", "--no-color"],
        input=value,
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode:
        raise RuntimeError(f"Vercel env update failed: {name}")


def main() -> int:
    if not SECRET_PATH.is_file() or SECRET_PATH.parent.resolve() != TEMP_DIR.resolve():
        raise RuntimeError("OAuth secret handoff file is missing")
    client_secret = SECRET_PATH.read_text(encoding="utf-8").strip()
    SECRET_PATH.unlink()
    if not client_secret:
        raise RuntimeError("OAuth secret is empty")

    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    oauth.OAuthCallbackHandler.expected_state = state
    oauth.OAuthCallbackHandler.code = None
    oauth.OAuthCallbackHandler.error = None
    server = HTTPServer(("127.0.0.1", 0), oauth.OAuthCallbackHandler)
    redirect_uri = f"http://127.0.0.1:{server.server_port}/"
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(oauth.SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "false",
        "prompt": "select_account consent",
        "login_hint": "nensyu.agent@gmail.com",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    URL_PATH.write_text(f"{oauth.AUTH_URL}?{urllib.parse.urlencode(params)}", encoding="utf-8")
    print("AUTH_READY", flush=True)
    # Chrome may probe the loopback URL before sending the real OAuth callback.
    # Keep serving briefly until a callback carrying the expected state arrives.
    server.timeout = 120
    for _ in range(5):
        server.handle_request()
        if oauth.OAuthCallbackHandler.code or oauth.OAuthCallbackHandler.error not in {None, "state_mismatch"}:
            break
        if oauth.OAuthCallbackHandler.error == "state_mismatch":
            oauth.OAuthCallbackHandler.error = None
    server.server_close()
    URL_PATH.unlink(missing_ok=True)
    if oauth.OAuthCallbackHandler.error or not oauth.OAuthCallbackHandler.code:
        raise RuntimeError("OAuth authorization failed")

    tokens = None
    for attempt in range(4):
        try:
            tokens = oauth.exchange_code(client_id=CLIENT_ID, client_secret=client_secret, code=oauth.OAuthCallbackHandler.code, redirect_uri=redirect_uri, verifier=verifier)
            break
        except urllib.error.URLError:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    if tokens is None:
        raise RuntimeError("OAuth token exchange failed")
    refresh_token = str(tokens.get("refresh_token", "")).strip()
    access_token = str(tokens.get("access_token", "")).strip()
    channel_ids = oauth.get_authorized_channel_ids(access_token)
    if CHANNEL_ID not in channel_ids and not oauth.can_access_channel_analytics(access_token, CHANNEL_ID):
        raise RuntimeError(f"Expected channel validation failed; authorized={','.join(channel_ids)}")
    print(f"CHANNEL_VALIDATED={CHANNEL_ID}", flush=True)
    if not refresh_token:
        raise RuntimeError("Refresh token was not returned")

    set_vercel_secret("YOUTUBE_CLIENT_ID", CLIENT_ID)
    set_vercel_secret("YOUTUBE_CLIENT_SECRET", client_secret)
    set_vercel_secret("YOUTUBE_REFRESH_TOKEN", refresh_token)
    client_secret = ""
    refresh_token = ""
    print("VERCEL_ENV_UPDATED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
