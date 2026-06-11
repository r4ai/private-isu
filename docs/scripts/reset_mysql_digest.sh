#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$ROOT_DIR/webapp"

docker compose exec mysql mysql -uroot -proot -e "
TRUNCATE TABLE performance_schema.events_statements_summary_by_digest;
"
