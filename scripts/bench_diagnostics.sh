#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL="${INTERVAL:-1}"
STATS_PATH="${STATS_PATH:-"$ROOT_DIR/docs/docker_stats.csv"}"
DIGEST_PATH="${DIGEST_PATH:-"$ROOT_DIR/docs/mysql_digest.txt"}"

CONTAINERS=(
  private-isu-app-1
  private-isu-mysql-1
  private-isu-nginx-1
  private-isu-memcached-1
)

mkdir -p "$ROOT_DIR/docs"
printf 'timestamp,container,cpu_perc,mem_usage,mem_perc,net_io,block_io,pids\n' > "$STATS_PATH"

"$ROOT_DIR/scripts/reset_mysql_digest.sh"

(
  while true; do
    ts="$(date --iso-8601=seconds)"
    docker stats --no-stream \
      --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}},{{.PIDs}}' \
      "${CONTAINERS[@]}" | while IFS= read -r line; do
        printf '%s,%s\n' "$ts" "$line"
      done >> "$STATS_PATH"
    sleep "$INTERVAL"
  done
) &
STATS_PID=$!

cleanup() {
  kill "$STATS_PID" 2>/dev/null || true
  wait "$STATS_PID" 2>/dev/null || true
}
trap cleanup EXIT

set +e
"$ROOT_DIR/scripts/bench_access_log.sh"
BENCH_STATUS=$?
set -e

cleanup
trap - EXIT

"$ROOT_DIR/scripts/mysql_digest.sh" | tee "$DIGEST_PATH"

printf 'docker stats csv: %s\n' "$STATS_PATH"
printf 'mysql digest: %s\n' "$DIGEST_PATH"

exit "$BENCH_STATUS"
