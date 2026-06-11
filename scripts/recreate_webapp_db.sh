#!/usr/bin/env bash
set -euo pipefail

if [ "${CONFIRM_RESET_DB_VOLUME:-}" != "1" ]; then
  cat <<'MSG' >&2
This deletes the Docker Compose MySQL volume and recreates the webapp stack.
Run with CONFIRM_RESET_DB_VOLUME=1 if this is intended.

  CONFIRM_RESET_DB_VOLUME=1 ./scripts/recreate_webapp_db.sh
MSG
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/webapp"
docker compose down -v
docker compose up -d --build
"$ROOT_DIR/scripts/apply_migrations.sh"
