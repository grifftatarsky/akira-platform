#!/usr/bin/env bash
# Nightly logical backup of the whole Postgres cluster.
#
# pg_dumpall, not pg_dump-per-database: the dump then also carries CREATE ROLE
# with the role passwords. init-db.sh only ever runs against an empty volume, so
# on a restore into an existing cluster the roles would otherwise have to be
# recreated by hand before any per-database dump would even load.
#
# Runs as a sidecar (see the pg-backup service) or standalone:
#   ./backup/pg-backup.sh once   # single backup, then exit
#   ./backup/pg-backup.sh loop   # backup at every local midnight (default)
set -euo pipefail

# Dumps carry every role's password and every row, so only the owner may read
# them. The container runs as root and would otherwise write them 0644.
umask 077

PGHOST="${PGHOST:-pgsql}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-${POSTGRES_USER:-admin}}"
export PGHOST PGPORT PGUSER
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETAIN="${BACKUP_RETAIN:-3}"
PREFIX="pgcluster"

log() { echo "[pg-backup] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

wait_for_postgres() {
  # Do not rely on compose's depends_on/healthcheck: not every deployment's
  # Postgres service defines one, and at midnight the server may be mid-restart
  # anyway. Poll here so the sidecar is correct either way.
  local tries="${PG_WAIT_TRIES:-60}" i=0
  until pg_isready -q; do
    i=$((i + 1))
    if [ "$i" -ge "$tries" ]; then
      log "postgres unreachable at $PGHOST:$PGPORT after $tries attempts"
      return 1
    fi
    [ "$i" = 1 ] && log "waiting for postgres at $PGHOST:$PGPORT"
    sleep 2
  done
}

backup_once() {
  mkdir -p "$BACKUP_DIR"
  local stamp target tmp
  stamp="$(date '+%Y%m%dT%H%M%S')"
  target="$BACKUP_DIR/$PREFIX-$stamp.sql.gz"
  tmp="$target.tmp"

  wait_for_postgres || { log "FAILED: no server to dump"; return 1; }
  log "dumping cluster from $PGUSER@$PGHOST:$PGPORT"
  # Dump to .tmp and rename only on success: a container killed mid-dump must
  # not leave a truncated file that then counts as one of the retained copies.
  if ! pg_dumpall --clean --if-exists | gzip -c > "$tmp"; then
    rm -f "$tmp"
    log "FAILED: dump did not complete"
    return 1
  fi
  mv "$tmp" "$target"
  log "wrote $target ($(du -h "$target" | cut -f1))"

  prune
}

prune() {
  local victims
  # Newest first, drop the ones past the retention count.
  victims="$(ls -1t "$BACKUP_DIR/$PREFIX-"*.sql.gz 2>/dev/null | tail -n +"$((BACKUP_RETAIN + 1))" || true)"
  if [ -n "$victims" ]; then
    echo "$victims" | while read -r old; do
      log "pruning $old"
      rm -f "$old"
    done
  fi
  log "retaining $(ls -1 "$BACKUP_DIR/$PREFIX-"*.sql.gz 2>/dev/null | wc -l | tr -d ' ') of $BACKUP_RETAIN"
}

seconds_to_midnight() {
  local now midnight
  now="$(date +%s)"
  midnight="$(date -d 'tomorrow 00:00:00' +%s)"
  echo "$((midnight - now))"
}

case "${1:-loop}" in
  once)
    backup_once
    ;;
  loop)
    # The stack is not always up at midnight (laptop asleep, compose down), so
    # catch up on boot whenever the newest dump is older than ~20h. Without this
    # a machine that is off overnight simply never backs up.
    newest="$(ls -1t "$BACKUP_DIR/$PREFIX-"*.sql.gz 2>/dev/null | head -1 || true)"
    if [ -z "$newest" ]; then
      log "no existing backup, taking one now"
      backup_once || true
    elif [ "$(( $(date +%s) - $(date -r "$newest" +%s) ))" -gt 72000 ]; then
      log "newest backup $newest is over 20h old, catching up"
      backup_once || true
    else
      log "newest backup $newest is recent, waiting for midnight"
    fi

    while true; do
      wait_for="$(seconds_to_midnight)"
      log "sleeping ${wait_for}s until midnight $(date '+%Z')"
      sleep "$wait_for"
      backup_once || log "backup failed, will retry at next midnight"
    done
    ;;
  *)
    echo "usage: $0 [once|loop]" >&2
    exit 64
    ;;
esac
