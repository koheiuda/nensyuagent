#!/usr/bin/env python3
"""年収エージェント YouTubeチャンネルのアナリティクスをCSVに書き出す。

出力先は data/youtube/ 配下（CLAUDE.md の出力ルールに従う）。

事前準備:
  1. GCP プロジェクトで YouTube Analytics API を有効化し、
     OAuth クライアント（デスクトップアプリ）の client_secret.json を取得する
  2. pip install google-api-python-client google-auth-oauthlib
  3. 認証情報の置き場所を環境変数で指定する（リポジトリ内に置かないこと）
       export YOUTUBE_CLIENT_SECRETS=~/.config/nensyuagent/client_secret.json
       export YOUTUBE_TOKEN_FILE=~/.config/nensyuagent/youtube_token.json  # 省略可

使い方:
  python tools/youtube_analytics_export.py --start 2025-09-01 --end 2026-08-31
  python tools/youtube_analytics_export.py --months 12
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import pathlib
import sys

# 年収エージェント チャンネル
CHANNEL_ID = "UCwrivK-bKlDu6ZJzC01GPBw"

SCOPES = ["https://www.googleapis.com/auth/yt-analytics.readonly"]

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_OUTDIR = REPO_ROOT / "data" / "youtube"

# レポート定義。metrics が権限や仕様で取得できない場合は個別にスキップする。
REPORTS = {
    "channel_daily": dict(
        dimensions="day",
        metrics=(
            "views,estimatedMinutesWatched,averageViewDuration,"
            "averageViewPercentage,subscribersGained,subscribersLost"
        ),
        sort="day",
    ),
    "channel_daily_impressions": dict(
        # インプレッション系は別クエリにする（同時取得できない組み合わせがあるため）
        dimensions="day",
        metrics="views,impressions,impressionsClickThroughRate",
        sort="day",
    ),
    "video_performance": dict(
        dimensions="video",
        metrics=(
            "views,estimatedMinutesWatched,averageViewDuration,"
            "averageViewPercentage,subscribersGained,likes,comments,shares"
        ),
        sort="-views",
        maxResults=200,
    ),
    "traffic_source": dict(
        dimensions="insightTrafficSourceType",
        metrics="views,estimatedMinutesWatched",
        sort="-views",
    ),
    "device_type": dict(
        dimensions="deviceType",
        metrics="views,estimatedMinutesWatched",
        sort="-views",
    ),
}


def build_client():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError:
        sys.exit(
            "依存パッケージが未インストールです:\n"
            "  pip install google-api-python-client google-auth-oauthlib"
        )

    secrets = os.environ.get("YOUTUBE_CLIENT_SECRETS")
    if not secrets:
        sys.exit("環境変数 YOUTUBE_CLIENT_SECRETS に client_secret.json のパスを設定してください")
    secrets_path = pathlib.Path(secrets).expanduser()
    if not secrets_path.exists():
        sys.exit(f"client_secret.json が見つかりません: {secrets_path}")

    token_path = pathlib.Path(
        os.environ.get("YOUTUBE_TOKEN_FILE", "~/.config/nensyuagent/youtube_token.json")
    ).expanduser()

    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            creds = InstalledAppFlow.from_client_secrets_file(
                str(secrets_path), SCOPES
            ).run_local_server(port=0)
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json())
        token_path.chmod(0o600)

    return build("youtubeAnalytics", "v2", credentials=creds)


def fetch(client, start: str, end: str, params: dict) -> dict:
    query = dict(
        ids=f"channel=={CHANNEL_ID}",
        startDate=start,
        endDate=end,
        **params,
    )
    return client.reports().query(**query).execute()


def write_csv(response: dict, path: pathlib.Path) -> int:
    headers = [c["name"] for c in response.get("columnHeaders", [])]
    rows = response.get("rows", [])
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)
    return len(rows)


def parse_args() -> argparse.Namespace:
    today = dt.date.today()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", help="開始日 YYYY-MM-DD")
    parser.add_argument("--end", help="終了日 YYYY-MM-DD（既定: 昨日）")
    parser.add_argument("--months", type=int, default=12, help="--start 未指定時に遡る月数")
    parser.add_argument("--outdir", default=str(DEFAULT_OUTDIR), help="CSVの出力先")
    parser.add_argument(
        "--reports",
        default=",".join(REPORTS),
        help=f"取得するレポート（カンマ区切り）: {', '.join(REPORTS)}",
    )
    args = parser.parse_args()

    args.end = args.end or (today - dt.timedelta(days=1)).isoformat()
    if not args.start:
        end_date = dt.date.fromisoformat(args.end)
        # 30日 × 月数 でおおまかに遡る
        args.start = (end_date - dt.timedelta(days=30 * args.months)).isoformat()
    return args


def main() -> int:
    args = parse_args()
    client = build_client()
    outdir = pathlib.Path(args.outdir)
    stamp = dt.date.today().strftime("%Y%m%d")

    failed = []
    for name in [r.strip() for r in args.reports.split(",") if r.strip()]:
        if name not in REPORTS:
            print(f"[skip] 未定義のレポート: {name}", file=sys.stderr)
            continue
        try:
            response = fetch(client, args.start, args.end, REPORTS[name])
        except Exception as exc:  # 指標の権限差でここに来ることがある
            print(f"[fail] {name}: {exc}", file=sys.stderr)
            failed.append(name)
            continue
        path = outdir / f"{name}_{args.start}_{args.end}_{stamp}.csv"
        count = write_csv(response, path)
        print(f"[ok] {name}: {count} rows -> {path.relative_to(REPO_ROOT)}")

    if failed:
        print(
            "\n取得できなかったレポート: " + ", ".join(failed) +
            "\n権限レベル（閲覧のみ／編集）と、指標の対応状況を確認してください。",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
