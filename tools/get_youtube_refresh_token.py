#!/usr/bin/env python3
"""YouTube Analytics API 用のリフレッシュトークンを一度だけ発行する。

YouTube Analytics の非公開指標（インプレッション・CTR・視聴維持率）は
サービスアカウントでは取得できず、チャンネル所有者本人のOAuth同意が要る。
このスクリプトはその同意を一度だけ行い、リフレッシュトークンを表示する。

依存パッケージなし（Python標準ライブラリのみ）。

事前準備:
  1. Google Cloud コンソールで YouTube Analytics API を有効化
  2. 認証情報 → OAuth クライアント ID → 種類「デスクトップアプリ」を作成
  3. 表示された クライアントID と クライアントシークレット を控える

使い方:
  export YOUTUBE_CLIENT_ID='...apps.googleusercontent.com'
  export YOUTUBE_CLIENT_SECRET='GOCSPX-...'
  python tools/get_youtube_refresh_token.py

  ブラウザが開くので、**チャンネルの権限を持つGoogleアカウント**で承認する。
  完了すると refresh token が表示されるので、Vercel の環境変数
  YOUTUBE_REFRESH_TOKEN に設定する。

注意: 表示されたトークンはパスワードと同じ重みを持つ。
      リポジトリにもチャットにも貼らないこと。
"""

from __future__ import annotations

import http.server
import json
import os
import secrets
import socket
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly"

_result: dict[str, str] = {}
_done = threading.Event()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        _result.update({k: v[0] for k, v in params.items()})

        if "code" in _result:
            msg = "認証が完了しました。ターミナルに戻ってください。"
        else:
            msg = "認証に失敗しました: " + _result.get("error", "unknown")

        body = f"<!doctype html><meta charset=utf-8><p style='font:16px system-ui'>{msg}</p>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        _done.set()

    def log_message(self, *args):  # 標準のアクセスログを黙らせる
        pass


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> int:
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    if not client_id or not client_secret:
        sys.exit("環境変数 YOUTUBE_CLIENT_ID と YOUTUBE_CLIENT_SECRET を設定してください")

    port = free_port()
    redirect_uri = f"http://127.0.0.1:{port}/"
    state = secrets.token_urlsafe(16)

    auth = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",   # リフレッシュトークンを得るために必須
        "prompt": "consent",        # 再実行時も確実に refresh_token を返させる
        "state": state,
    })

    server = http.server.HTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    print("ブラウザで承認してください（チャンネルの権限を持つアカウントで）:\n")
    print(auth + "\n")
    try:
        webbrowser.open(auth)
    except Exception:
        pass

    if not _done.wait(timeout=300):
        server.shutdown()
        sys.exit("タイムアウトしました（5分）。もう一度実行してください。")
    server.shutdown()

    if _result.get("state") != state:
        sys.exit("state が一致しません。中断しました。")
    if "code" not in _result:
        sys.exit("認証に失敗しました: " + _result.get("error", "unknown"))

    data = urllib.parse.urlencode({
        "code": _result["code"],
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }).encode()

    req = urllib.request.Request(TOKEN_URL, data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit("トークン交換に失敗しました: " + e.read().decode(errors="replace"))

    refresh = payload.get("refresh_token")
    if not refresh:
        sys.exit("refresh_token が返りませんでした。"
                 "Google アカウントの「サードパーティアクセス」から既存の許可を解除して再実行してください。")

    print("\n" + "=" * 60)
    print("YOUTUBE_REFRESH_TOKEN=" + refresh)
    print("=" * 60)
    print("\nこの値を Vercel の環境変数に設定してください。")
    print("パスワードと同じ扱いです。リポジトリやチャットに貼らないでください。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
