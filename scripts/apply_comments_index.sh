#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/webapp"

docker compose exec mysql mysql -uroot -proot isuconp -e "
ALTER TABLE comments
  ADD INDEX comments_post_id_created_at_idx (post_id, created_at DESC);
"
