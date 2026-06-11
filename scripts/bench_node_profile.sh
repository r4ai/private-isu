#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${PROFILE_DIR:-"$ROOT_DIR/docs/node-profile"}"
SUMMARY_PATH="${SUMMARY_PATH:-"$ROOT_DIR/docs/node_profile_summary.txt"}"

mkdir -p "$PROFILE_DIR"
rm -f "$PROFILE_DIR"/*.cpuprofile "$SUMMARY_PATH"

set +e
ISUCONP_NODE_PROFILE_PATH=/tmp/isuconp-node.cpuprofile \
RESTORE_ACCESS_LOG=0 \
  "$ROOT_DIR/scripts/bench_access_log.sh"
BENCH_STATUS=$?
set -e

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
if [ -z "$PROFILE_FILE" ]; then
  echo "node profile was not generated" >&2
  exit 1
fi

node - "$PROFILE_FILE" > "$SUMMARY_PATH" <<'JS'
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

cat "$SUMMARY_PATH"
printf 'node profile: %s\n' "$PROFILE_FILE"
printf 'node profile summary: %s\n' "$SUMMARY_PATH"

exit "$BENCH_STATUS"
