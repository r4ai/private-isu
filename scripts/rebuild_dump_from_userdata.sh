#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MYSQL_CLIENT_BIN="/home/linuxbrew/.linuxbrew/opt/mysql-client/bin"

cd "$ROOT_DIR/benchmarker/userdata"

if ! ruby -e 'require "mysql2"' >/dev/null 2>&1; then
  cat <<'MSG' >&2
Ruby gem mysql2 is required to run benchmarker/userdata/load.rb.

Install mysql2 for the host Ruby, or use the Docker Compose DB route:

  ./scripts/apply_comments_index.sh
  ./scripts/dump_current_webapp_db.sh
MSG
  exit 1
fi

if [ -d "$MYSQL_CLIENT_BIN" ]; then
  export PATH="$MYSQL_CLIENT_BIN:$PATH"
fi

export ISUCONP_DB_HOST="${ISUCONP_DB_HOST:-127.0.0.1}"
export ISUCONP_DB_PORT="${ISUCONP_DB_PORT:-3306}"
export ISUCONP_DB_USER="${ISUCONP_DB_USER:-root}"
export ISUCONP_DB_PASSWORD="${ISUCONP_DB_PASSWORD:-root}"
export ISUCONP_DB_NAME="${ISUCONP_DB_NAME:-isuconp}"

ruby load.rb

cp "$ROOT_DIR/benchmarker/userdata/dump.sql.bz2" "$ROOT_DIR/webapp/sql/dump.sql.bz2"

printf 'updated: %s\n' "$ROOT_DIR/webapp/sql/dump.sql.bz2"
