#!/usr/bin/env python3
"""年収エージェント：WordPress へ記事を「下書き」で入稿するスクリプト。

Basic認証で保護されたサイトに対応。XML-RPC を既定とし、REST API も選べる。

認証情報はリポジトリに書かない。プロジェクトルートの .env（.gitignore 済み）
または環境変数から読む。

  WP_URL=https://test-nensyu-agent.kubooo.com
  WP_USER=nensyu_admin
  WP_PASS=********
  WP_BASIC_USER=check
  WP_BASIC_PASS=********

使い方:
  python3 tools/wp_draft.py --html docs/articles/SIer転職_本文_20260830.html \
      --title "SIer転職は難しい？上流工程しかない経歴の伝え方と年収の上げ方" \
      --slug sier-tenshoku --category コラム

  # 送信せず中身だけ確認
  python3 tools/wp_draft.py --html ... --title ... --dry-run

  # 接続だけ確認
  python3 tools/wp_draft.py --check
"""

import argparse
import base64
import os
import sys
import xmlrpc.client
from http.client import HTTPSConnection
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent

SETUP_HELP = """
WordPress の認証情報が見つかりません。

プロジェクトルートに .env を作成してください（.gitignore 済みなのでコミットされません）。

  WP_URL=https://test-nensyu-agent.kubooo.com
  WP_USER=nensyu_admin
  WP_PASS=（WordPressのパスワード）
  WP_BASIC_USER=check
  WP_BASIC_PASS=（Basic認証のパスワード）
"""


def load_env():
    """.env を読んで os.environ に反映する（既存の環境変数を優先）。"""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class BasicAuthTransport(xmlrpc.client.Transport):
    """Basic認証ヘッダを付けて XML-RPC を話すトランスポート。"""

    def __init__(self, basic_user, basic_pass):
        super().__init__()
        self._header = None
        if basic_user:
            token = base64.b64encode(f"{basic_user}:{basic_pass}".encode()).decode()
            self._header = f"Basic {token}"

    def send_headers(self, connection, headers):
        super().send_headers(connection, headers)
        if self._header:
            connection.putheader("Authorization", self._header)

    def make_connection(self, host):
        conn = super().make_connection(host)
        return conn


def check_connection(base, basic_user, basic_pass):
    """xmlrpc.php に到達できるかだけ確かめる。"""
    parsed = urlparse(base)
    conn = HTTPSConnection(parsed.netloc, timeout=30)
    headers = {}
    if basic_user:
        token = base64.b64encode(f"{basic_user}:{basic_pass}".encode()).decode()
        headers["Authorization"] = f"Basic {token}"
    conn.request("GET", "/xmlrpc.php", headers=headers)
    res = conn.getresponse()
    body = res.read(200).decode("utf-8", "replace")
    print(f"GET /xmlrpc.php → HTTP {res.status}")
    print(f"  {body.strip()[:150]}")
    if res.status == 401:
        print("  → Basic認証に失敗しています。WP_BASIC_USER / WP_BASIC_PASS を確認してください。")
    elif res.status == 405:
        print("  → 到達OK（405はGETを受け付けないだけで正常）。投稿できます。")
    elif res.status == 404:
        print("  → xmlrpc.php が見つかりません。--mode rest を試してください。")
    elif res.status == 200:
        print("  → 到達OK。投稿できます。")
    return res.status


def post_xmlrpc(args, html, base, user, password, basic_user, basic_pass):
    endpoint = os.environ.get("WP_XMLRPC") or f"{base}/xmlrpc.php"
    transport = BasicAuthTransport(basic_user, basic_pass)
    wp = xmlrpc.client.ServerProxy(endpoint, transport=transport, allow_none=True)

    post = {
        "post_type": "post",
        "post_status": args.status,
        "post_title": args.title,
        "post_content": html,
    }
    if args.slug:
        post["post_name"] = args.slug
    if args.excerpt:
        post["post_excerpt"] = args.excerpt
    if args.category:
        post["terms_names"] = {"category": [args.category]}

    if args.post_id:
        wp.wp.editPost(1, user, password, args.post_id, post)
        post_id = args.post_id
        print("下書きを更新しました")
    else:
        post_id = wp.wp.newPost(1, user, password, post)
        print("下書きを作成しました")

    print(f"  記事ID  : {post_id}")
    print(f"  ステータス: {args.status}")
    print(f"  編集URL : {base}/wp-admin/post.php?post={post_id}&action=edit")
    return post_id


def post_rest(args, html, base, user, password, basic_user, basic_pass):
    """REST API 版。パスワードは「アプリケーションパスワード」を使うこと。"""
    import json
    from urllib.error import HTTPError
    from urllib.request import Request, urlopen

    path = f"/wp-json/wp/v2/posts" + (f"/{args.post_id}" if args.post_id else "")
    payload = {"title": args.title, "content": html, "status": args.status}
    if args.slug:
        payload["slug"] = args.slug
    if args.excerpt:
        payload["excerpt"] = args.excerpt

    headers = {"Content-Type": "application/json; charset=utf-8"}
    wp_token = base64.b64encode(f"{user}:{password}".encode()).decode()
    headers["Authorization"] = f"Basic {wp_token}"
    if basic_user:
        # Basic認証とWP認証が競合するため、REST利用時はサーバ側の除外設定が必要
        print("※ Basic認証とWP認証のヘッダが競合します。RESTを使う場合は")
        print("  サーバ側で /wp-json/ をBasic認証の対象外にしてください。")

    req = Request(base + path, data=json.dumps(payload).encode("utf-8"),
                  headers=headers, method="POST")
    try:
        with urlopen(req, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except HTTPError as exc:
        sys.exit(f"入稿に失敗しました（HTTP {exc.code}）\n{exc.read()[:800].decode('utf-8','replace')}")

    print("下書きを作成しました")
    print(f"  記事ID  : {data.get('id')}")
    print(f"  ステータス: {data.get('status')}")
    print(f"  編集URL : {base}/wp-admin/post.php?post={data.get('id')}&action=edit")
    return data.get("id")


def main():
    p = argparse.ArgumentParser(description="WordPress に下書きを入稿する")
    p.add_argument("--html", help="本文HTMLのファイルパス")
    p.add_argument("--title")
    p.add_argument("--slug")
    p.add_argument("--excerpt", help="抜粋／メタディスクリプション")
    p.add_argument("--category", default="コラム", help="カテゴリ名（既定：コラム）")
    p.add_argument("--post-id", type=int, help="指定すると既存投稿を更新する")
    p.add_argument("--mode", default="xmlrpc", choices=["xmlrpc", "rest"])
    p.add_argument("--status", default="draft", choices=["draft", "pending"],
                   help="draft（既定）または pending。publish は指定できない")
    p.add_argument("--dry-run", action="store_true", help="送信せず内容を表示")
    p.add_argument("--check", action="store_true", help="接続確認のみ")
    args = p.parse_args()

    load_env()
    base = os.environ.get("WP_URL", "").rstrip("/")
    user = os.environ.get("WP_USER", "")
    password = os.environ.get("WP_PASS", "")
    basic_user = os.environ.get("WP_BASIC_USER", "")
    basic_pass = os.environ.get("WP_BASIC_PASS", "")

    if args.check:
        if not base:
            sys.exit(SETUP_HELP)
        check_connection(base, basic_user, basic_pass)
        return

    if not (args.html and args.title):
        sys.exit("--html と --title は必須です（接続確認だけなら --check）")

    html_path = Path(args.html)
    if not html_path.is_absolute():
        html_path = ROOT / html_path
    if not html_path.exists():
        sys.exit(f"本文HTMLが見つかりません: {html_path}")
    html = html_path.read_text(encoding="utf-8")

    if args.dry_run:
        print(f"接続先    : {base}")
        print(f"モード    : {args.mode}")
        print(f"タイトル  : {args.title}")
        print(f"スラッグ  : {args.slug}")
        print(f"カテゴリ  : {args.category}")
        print(f"ステータス: {args.status}")
        print(f"本文      : {len(html)} 文字")
        print(f"Basic認証 : {'あり (' + basic_user + ')' if basic_user else 'なし'}")
        return

    if not (base and user and password):
        sys.exit(SETUP_HELP)

    if args.mode == "xmlrpc":
        post_xmlrpc(args, html, base, user, password, basic_user, basic_pass)
    else:
        post_rest(args, html, base, user, password, basic_user, basic_pass)


if __name__ == "__main__":
    main()
