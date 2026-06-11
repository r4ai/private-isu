#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$ROOT_DIR/webapp"

docker compose exec mysql mysql -uroot -proot isuconp -e "
SELECT
  DIGEST_TEXT,
  COUNT_STAR,
  ROUND(SUM_TIMER_WAIT / 1000000000000, 3) AS total_sec,
  ROUND(AVG_TIMER_WAIT / 1000000000000, 6) AS avg_sec,
  SUM_ROWS_SENT,
  SUM_ROWS_EXAMINED
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = 'isuconp'
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
"
