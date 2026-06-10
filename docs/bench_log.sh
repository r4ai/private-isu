#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CSV_PATH="${1:-"$ROOT_DIR/docs/bench_results.csv"}"
TARGET_URL="${TARGET_URL:-http://host.docker.internal}"
IMAGE_NAME="${BENCH_IMAGE:-private-isu-benchmarker}"

cd "$ROOT_DIR/benchmarker"

docker build -q -t "$IMAGE_NAME" . >/dev/null

RESULT_JSON="$(
  docker run \
    --network host \
    --add-host host.docker.internal:host-gateway \
    -i "$IMAGE_NAME" \
    /bin/benchmarker \
    -t "$TARGET_URL" \
    -u /opt/userdata
)"

printf '%s\n' "$RESULT_JSON"

mkdir -p "$(dirname "$CSV_PATH")"

if [ ! -f "$CSV_PATH" ]; then
  printf 'timestamp,score,success,fail,messages,pass\n' > "$CSV_PATH"
fi

python3 - "$CSV_PATH" "$RESULT_JSON" <<'PY'
import csv
import json
import sys
from datetime import datetime, timezone

csv_path, result_json = sys.argv[1], sys.argv[2]
result = json.loads(result_json)

row = {
    "timestamp": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    "score": result.get("score"),
    "success": result.get("success"),
    "fail": result.get("fail"),
    "messages": " | ".join(result.get("messages") or []),
    "pass": result.get("pass"),
}

with open(csv_path, "a", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=row.keys())
    writer.writerow(row)
PY

printf 'appended: %s\n' "$CSV_PATH"
