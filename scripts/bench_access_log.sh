#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_URL="${TARGET_URL:-http://host.docker.internal}"
IMAGE_NAME="${BENCH_IMAGE:-private-isu-benchmarker}"
CSV_PATH="${CSV_PATH:-"$ROOT_DIR/docs/bench_results.csv"}"
SUMMARY_CSV_PATH="${SUMMARY_CSV_PATH:-"$ROOT_DIR/docs/bench_access_summary.csv"}"

mkdir -p "$ROOT_DIR/docs"

cd "$ROOT_DIR/webapp"
ISUCONP_ACCESS_LOG=1 docker compose up -d --build mysql app nginx
docker compose exec -T nginx nginx -s reload

cd "$ROOT_DIR/benchmarker"
docker build -q -t "$IMAGE_NAME" . >/dev/null

set +e
RESULT_JSON="$(
  docker run \
    --network host \
    --add-host host.docker.internal:host-gateway \
    -i "$IMAGE_NAME" \
    /bin/benchmarker \
    -t "$TARGET_URL" \
    -u /opt/userdata
)"
BENCH_STATUS=$?
set -e

printf '%s\n' "$RESULT_JSON"

cd "$ROOT_DIR/webapp"
SUMMARY_JSON="$(
  docker compose exec -T app env NODE_OPTIONS= node -e \
    "fetch('http://127.0.0.1:8080/__access_summary').then((r) => r.text()).then((t) => process.stdout.write(t))"
)"

python3 - "$CSV_PATH" "$SUMMARY_CSV_PATH" "$SUMMARY_JSON" "$RESULT_JSON" <<'PY'
import csv
import json
import sys
from datetime import datetime, timezone

csv_path, summary_csv_path, summary_json, result_json = sys.argv[1:5]
timestamp = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

if result_json.strip():
    result = json.loads(result_json)
    row = {
        "timestamp": timestamp,
        "score": result.get("score"),
        "success": result.get("success"),
        "fail": result.get("fail"),
        "messages": " | ".join(result.get("messages") or []),
        "pass": result.get("pass"),
    }

    try:
        with open(csv_path, newline="") as f:
            has_header = bool(f.readline())
    except FileNotFoundError:
        has_header = False

    with open(csv_path, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=row.keys())
        if not has_header:
            writer.writeheader()
        writer.writerow(row)

summary_rows = []
summary = json.loads(summary_json)
for row in summary.get("rows", []):
    statuses = " ".join(
        f"{status}:{count}" for status, count in sorted(
            (row.get("statuses") or {}).items(),
            key=lambda item: int(item[0]),
        )
    )
    top_paths = " ".join(
        f"{item.get('path')}:{item.get('count')}"
        for item in row.get("top_paths", [])
    )
    summary_rows.append({
        "timestamp": timestamp,
        "method": row.get("method"),
        "route": row.get("route"),
        "count": row.get("count"),
        "total_ms": row.get("total_ms"),
        "avg_ms": row.get("avg_ms"),
        "p95_ms": row.get("p95_ms"),
        "max_ms": row.get("max_ms"),
        "statuses": statuses,
        "bytes": row.get("bytes"),
        "top_paths": top_paths,
    })

summary_rows.sort(key=lambda r: (r["total_ms"], r["count"]), reverse=True)

fieldnames = [
    "timestamp",
    "method",
    "route",
    "count",
    "total_ms",
    "avg_ms",
    "p95_ms",
    "max_ms",
    "statuses",
    "bytes",
    "top_paths",
]
try:
    with open(summary_csv_path, newline="") as f:
        has_header = bool(f.readline())
except FileNotFoundError:
    has_header = False

with open(summary_csv_path, "a", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    if not has_header:
        writer.writeheader()
    writer.writerows(summary_rows)

print()
print("endpoint access summary")
print("method route count total_ms avg_ms p95_ms max_ms statuses")
for row in summary_rows:
    print(
        f"{row['method']} {row['route']} {row['count']} "
        f"{row['total_ms']:.3f} {row['avg_ms']:.3f} {row['p95_ms']:.3f} "
        f"{row['max_ms']:.3f} {row['statuses']}"
    )
PY

printf 'summary csv: %s\n' "$SUMMARY_CSV_PATH"
printf 'bench csv: %s\n' "$CSV_PATH"

if [ "${RESTORE_ACCESS_LOG:-1}" = "1" ]; then
  cd "$ROOT_DIR/webapp"
  ISUCONP_ACCESS_LOG= docker compose up -d --force-recreate app >/dev/null
fi

exit "$BENCH_STATUS"
