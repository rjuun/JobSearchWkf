#!/usr/bin/env bash
# Hourly Postgres backup for a Postgres container running via Synology Container Manager.
#
# Design: 24 rotating slots keyed by hour-of-day (H00..H23). Each run overwrites only
# the slot for the current hour, so the folder always holds ~last 24h of hourly dumps
# on a fixed footprint (~24 x dump size). This gives hour-by-hour recovery points from
# the source folder itself, independent of Hyperbackup's schedule - which matters because
# Synology's Hyperbackup GUI only supports a single run per day, not hourly. Hyperbackup
# then just needs to run once a day to capture that whole rolling window as one version.

set -euo pipefail

# ==== CONFIG - edit these before first run ====
CONTAINER_NAME="roleproof-db"                 # name shown by `docker ps`
DB_USER="postgres"                        # role used to connect/dump
DB_PASSWORD="${DB_PASSWORD:-}"             # set via environment; leave unset if container trusts local connections
BACKUP_DIR="//volume9/postgres_dump/dump"       # Hyperbackup source folder (NOT the "backups" share)
# ================================================

HOUR_SLOT="H$(date +%H)"                  # H00 .. H23
LOG_FILE="${BACKUP_DIR}/backup.log"
mkdir -p "${BACKUP_DIR}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}"; }

DOCKER_EXEC="docker exec"
if [ -n "${DB_PASSWORD}" ]; then
  DOCKER_EXEC="docker exec -e PGPASSWORD=${DB_PASSWORD}"
fi

log "Backup started (slot ${HOUR_SLOT})"

# 1. Roles, permissions, tablespaces (not included in per-database dumps)
if ${DOCKER_EXEC} "${CONTAINER_NAME}" pg_dumpall -U "${DB_USER}" --globals-only \
    | gzip -n > "${BACKUP_DIR}/globals_${HOUR_SLOT}.sql.gz.tmp"; then
  mv "${BACKUP_DIR}/globals_${HOUR_SLOT}.sql.gz.tmp" "${BACKUP_DIR}/globals_${HOUR_SLOT}.sql.gz"
  log "Dumped globals -> globals_${HOUR_SLOT}.sql.gz"
else
  log "ERROR dumping globals"
  rm -f "${BACKUP_DIR}/globals_${HOUR_SLOT}.sql.gz.tmp"
  exit 1
fi

# 2. Every real database, in custom format (compressed, parallel-restorable)
DB_LIST=$(${DOCKER_EXEC} "${CONTAINER_NAME}" psql -U "${DB_USER}" -tAc \
  "SELECT datname FROM pg_database WHERE datistemplate = false;")

for DB in ${DB_LIST}; do
  if ${DOCKER_EXEC} "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -Fc "${DB}" \
      > "${BACKUP_DIR}/${DB}_${HOUR_SLOT}.dump.tmp"; then
    mv "${BACKUP_DIR}/${DB}_${HOUR_SLOT}.dump.tmp" "${BACKUP_DIR}/${DB}_${HOUR_SLOT}.dump"
    log "Dumped ${DB} -> ${DB}_${HOUR_SLOT}.dump"
  else
    log "ERROR dumping ${DB}"
    rm -f "${BACKUP_DIR}/${DB}_${HOUR_SLOT}.dump.tmp"
    exit 1
  fi
done

log "Backup finished OK"

# Keep the log file itself from growing forever
tail -n 1000 "${LOG_FILE}" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "${LOG_FILE}"
