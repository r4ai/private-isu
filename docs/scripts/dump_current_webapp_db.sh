#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_PATH="${OUT_PATH:-"$ROOT_DIR/webapp/sql/dump.sql.bz2"}"

cd "$ROOT_DIR/webapp"

docker compose exec mysql mysqldump \
  -uroot \
  -proot \
  --hex-blob \
  --add-drop-database \
  --databases isuconp \
  | bzip2 > "$OUT_PATH"

printf 'updated: %s\n' "$OUT_PATH"
