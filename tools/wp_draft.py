#!/usr/bin/env python3
"""WordPress へ記事を「下書き」で入稿するスクリプト。

認証情報はリポジトリに書かない。プロジェクトルートの .env（.gitignore 済み）
または環境変数から読む。

  WP_URL=https://stock-sun.com
  WP_USER=<WPユーザー名>
  WP_APP_PASSWORD=<アプリケーションパスワード（WP管理画面 > ユーザー > プロフィール で発行）>

使い方:
  python3 tools/wp_draft.py --html docs/articles/xxx.html --title "..." --slug xxx --meta "..."
  python3 tools/wp_draft.py --html ... --title ... --slug ... --post-id 1234   # 既存下書きの更新
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests
from requests.auth import HTTPBasicAuth

ROOT = Path(__file__).resolve().parent.parent
SETUP_HELP = """
WordPress の認証情報が見つかりません。

1) WP管理画面 > ユーザー > プロフィール > 「アプリケーションパスワード」で新規発行
2) プロジェクトルートに .env を作成（.gitignore 済みなのでコミットされません）

   WP_URL=https://stock-sun.com
   WP_USER=your-wp-username
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx

3) 再実行してください。
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


def build_payload(args, html):
    payload = {
        "title": args.title,
        "content": html,
        "status": args.status,
    }
    if args.slug:
        payload["slug"] = args.slug
    if args.excerpt:
        payload["excerpt"] = args.excerpt
    if args.meta:
        # SEOプラグインのメタ欄。プラグインによりキーが異なるため両方入れる。
        # REST 経由で書けるかはプラグイン設定に依存するので、失敗しても投稿は続行する。
        payload["meta"] = {
            "_yoast_wpseo_metadesc": args.meta,
            "rank_math_description": args.meta,
        }
    if args.categories:
        payload["categories"] = [int(c) for c in args.categories.split(",")]
    if args.tags:
        payload["tags"] = [int(t) for t in args.tags.split(",")]
    return payload


def main():
    p = argparse.ArgumentParser(description="WordPress に下書きを入稿する")
    p.add_argument("--html", required=True, help="本文HTMLのファイルパス")
    p.add_argument("--title", required=True)
    p.add_argument("--slug")
    p.add_argument("--meta", help="メタディスクリプション")
    p.add_argument("--excerpt", help="抜粋")
    p.add_argument("--categories", help="カテゴリID（カンマ区切り）")
    p.add_argument("--tags", help="タグID（カンマ区切り）")
    p.add_argument("--post-id", type=int, help="指定すると既存投稿を更新する")
    p.add_argument(
        "--status",
        default="draft",
        choices=["draft", "pending"],
        help="draft（既定）または pending。publish は指定できない",
    )
    p.add_argument("--dry-run", action="store_true", help="送信せずペイロードだけ表示")
    args = p.parse_args()

    html_path = Path(args.html)
    if not html_path.is_absolute():
        html_path = ROOT / html_path
    if not html_path.exists():
        sys.exit(f"本文HTMLが見つかりません: {html_path}")
    html = html_path.read_text(encoding="utf-8")

    payload = build_payload(args, html)

    if args.dry_run:
        preview = dict(payload)
        preview["content"] = f"<{len(html)} chars>"
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return

    load_env()
    base = os.environ.get("WP_URL", "").rstrip("/")
    user = os.environ.get("WP_USER", "")
    app_pw = os.environ.get("WP_APP_PASSWORD", "")
    if not (base and user and app_pw):
        sys.exit(SETUP_HELP)

    endpoint = f"{base}/wp-json/wp/v2/posts"
    if args.post_id:
        endpoint = f"{endpoint}/{args.post_id}"

    try:
        res = requests.post(
            endpoint,
            auth=HTTPBasicAuth(user, app_pw),
            json=payload,
            timeout=60,
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
    except requests.RequestException as exc:
        sys.exit(f"WordPress への接続に失敗しました: {exc}")

    if res.status_code >= 400:
        sys.exit(
            f"入稿に失敗しました（HTTP {res.status_code}）\n{res.text[:1000]}\n\n"
            "401/403 の場合はアプリケーションパスワードと権限を、"
            "404 の場合は WP_URL と REST API の有効化を確認してください。"
        )

    data = res.json()
    print("入稿しました（下書き）")
    print(f"  post ID : {data.get('id')}")
    print(f"  status  : {data.get('status')}")
    print(f"  編集URL : {base}/wp-admin/post.php?post={data.get('id')}&action=edit")
    print(f"  プレビュー: {data.get('link')}")
    if data.get("status") != "draft":
        print("  ⚠ ステータスが draft ではありません。管理画面で確認してください。")


if __name__ == "__main__":
    main()
