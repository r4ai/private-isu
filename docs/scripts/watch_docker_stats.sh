#!/usr/bin/env bash
set -euo pipefail

INTERVAL="${INTERVAL:-1}"

CONTAINERS=(
  private-isu-app-1
  private-isu-mysql-1
  private-isu-nginx-1
  private-isu-memcached-1
)

while true; do
  date '+%H:%M:%S'
  docker stats --no-stream "${CONTAINERS[@]}"
  sleep "$INTERVAL"
done
