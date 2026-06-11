#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/webapp/sql/migrations"
MYSQL_DATABASE="${MYSQL_DATABASE:-isuconp}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-root}"

mysql_exec() {
  docker compose exec -T mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" "$@"
}

mysql_query() {
  mysql_exec -Nse "$1"
}

wait_for_mysql() {
  for _ in $(seq 1 300); do
    if mysql_exec -e "SELECT 1" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "mysql did not become ready for migrations in time" >&2
  return 1
}

sql_string() {
  printf "%s" "$1" | sed "s/'/''/g"
}

add_index_if_missing() {
  local table_name="$1"
  local index_name="$2"
  local alter_sql="$3"
  local table_sql
  local index_sql
  local count

  table_sql="$(sql_string "$table_name")"
  index_sql="$(sql_string "$index_name")"
  count="$(mysql_query "
    SELECT COUNT(*)
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = '$table_sql'
       AND index_name = '$index_sql'
  ")"

  if [ "$count" = "0" ]; then
    echo "adding index: $table_name.$index_name"
    mysql_exec -e "$alter_sql"
  else
    echo "index exists: $table_name.$index_name"
  fi
}

cd "$ROOT_DIR/webapp"
wait_for_mysql

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "no migrations directory: $MIGRATIONS_DIR"
  exit 0
fi

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sh)

if [ "${#migrations[@]}" -eq 0 ]; then
  echo "no migrations found"
  exit 0
fi

for migration in "${migrations[@]}"; do
  echo "applying migration: ${migration#$ROOT_DIR/}"
  # shellcheck source=/dev/null
  source "$migration"
done
