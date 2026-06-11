#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL="${INTERVAL:-1}"
STATS_PATH="${STATS_PATH:-"$ROOT_DIR/docs/docker_stats.csv"}"
DIGEST_PATH="${DIGEST_PATH:-"$ROOT_DIR/docs/mysql_digest.txt"}"
NODE_PROFILE="${NODE_PROFILE:-0}"
PROFILE_DIR="${PROFILE_DIR:-"$ROOT_DIR/docs/node-profile"}"
PROFILE_SUMMARY_PATH="${PROFILE_SUMMARY_PATH:-"$ROOT_DIR/docs/node_profile_summary.txt"}"

CONTAINERS=(
  private-isu-app-1
  private-isu-mysql-1
  private-isu-nginx-1
  private-isu-memcached-1
)

mkdir -p "$ROOT_DIR/docs"
mkdir -p "$PROFILE_DIR"
printf 'timestamp,container,cpu_perc,mem_usage,mem_perc,net_io,block_io,pids\n' > "$STATS_PATH"
if [ "$NODE_PROFILE" = "1" ]; then
  rm -f "$PROFILE_DIR"/*.cpuprofile "$PROFILE_SUMMARY_PATH"
fi

"$ROOT_DIR/scripts/reset_mysql_digest.sh"

(
  while true; do
    ts="$(date --iso-8601=seconds)"
    docker stats --no-stream \
      --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}},{{.PIDs}}' \
      "${CONTAINERS[@]}" 2>/dev/null | while IFS= read -r line; do
        printf '%s,%s\n' "$ts" "$line"
      done >> "$STATS_PATH" || true
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
if [ "$NODE_PROFILE" = "1" ]; then
  ISUCONP_NODE_PROFILE_PATH=/tmp/isuconp-node.cpuprofile \
  RESTORE_ACCESS_LOG=0 \
    "$ROOT_DIR/scripts/bench_access_log.sh"
else
  "$ROOT_DIR/scripts/bench_access_log.sh"
fi
BENCH_STATUS=$?
set -e

cleanup
trap - EXIT

if [ "$NODE_PROFILE" = "1" ]; then
  cd "$ROOT_DIR/webapp"
  docker compose exec -T app sh -c 'kill -USR2 1' >/dev/null || true
  for _ in $(seq 1 20); do
    state="$(docker compose ps app --format json | node -e "let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => { const row = data.trim() ? JSON.parse(data) : {}; console.log(row.State || '') })")"
    [ "$state" = "exited" ] && break
    sleep 1
  done
  docker compose cp app:/tmp/. "$PROFILE_DIR" >/dev/null
  ISUCONP_NODE_PROFILE_PATH= ISUCONP_ACCESS_LOG= docker compose up -d --force-recreate app >/dev/null

  PROFILE_FILE="$(find "$PROFILE_DIR" -maxdepth 1 -name '*.cpuprofile' -type f -printf '%s %p\n' | sort -nr | awk 'NR == 1 { print $2 }')"
  if [ -n "$PROFILE_FILE" ]; then
    node - "$PROFILE_FILE" > "$PROFILE_SUMMARY_PATH" <<'JS'
const fs = require('fs')
const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
const hits = new Map()
for (const id of profile.samples || []) {
  hits.set(id, (hits.get(id) || 0) + 1)
}
const rows = [...hits.entries()].map(([id, count]) => {
  const node = nodes.get(id)
  const frame = node?.callFrame || {}
  const url = frame.url || ''
  return {
    count,
    functionName: frame.functionName || '(anonymous)',
    url: url.replace(/^file:\/\//, ''),
    line: frame.lineNumber === undefined ? '' : frame.lineNumber + 1,
  }
})
rows.sort((a, b) => b.count - a.count)
const total = rows.reduce((sum, row) => sum + row.count, 0)
console.log(`profile: ${process.argv[2]}`)
console.log(`samples: ${total}`)
console.log('self_pct samples function location')
for (const row of rows.slice(0, 40)) {
  const pct = total === 0 ? 0 : (row.count * 100) / total
  console.log(`${pct.toFixed(2)} ${row.count} ${row.functionName} ${row.url}:${row.line}`)
}
JS
    cat "$PROFILE_SUMMARY_PATH"
  else
    echo "node profile was not generated" >&2
  fi
fi

"$ROOT_DIR/scripts/mysql_digest.sh" | tee "$DIGEST_PATH"

printf 'docker stats csv: %s\n' "$STATS_PATH"
printf 'mysql digest: %s\n' "$DIGEST_PATH"
if [ "$NODE_PROFILE" = "1" ]; then
  printf 'node profile summary: %s\n' "$PROFILE_SUMMARY_PATH"
fi

exit "$BENCH_STATUS"
