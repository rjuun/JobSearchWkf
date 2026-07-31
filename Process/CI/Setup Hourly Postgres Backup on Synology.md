---
ci-title: postgres-backup-setup-guide
ci-area: Infrastructure
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-07-31
ci-estimated-time: "4"
ci-time-spent: 4
pr-source:
pr-target:
---
---

```simple-time-tracker
{"entries":[{"name":"Development","startTime":"2026-07-30T19:22:46.000Z","endTime":"2026-07-30T23:17:49.000Z"}]}
```



---

## 1. What is the problem or opportunity?
 

## 2. What would the improvement look like?


## 3. Resources or references


## 4. Notes / Progress log




# Hourly Postgres Backup on Synology

Setup for a Postgres container on your NAS, dumped hourly via Task Scheduler, versioned by Hyperbackup onto Storage Pool 4 / Volume 2 (Backup).

## How it works

1. `postgres-backup.sh` runs every hour via DSM Task Scheduler. It uses `docker exec` to run `pg_dumpall` (roles) and `pg_dump -Fc` (each database) inside your Postgres container, writing compressed dumps to a fixed folder — same filenames every run, overwritten in place.
2. Hyperbackup watches that folder on an hourly schedule and versions it with **Smart Recycle**, which keeps every version for the first day, then thins older versions to daily/weekly automatically using block-level dedup. Because dumps overwrite the same files, each hourly Hyperbackup run only stores the *changed blocks*, not a whole new copy — this is what keeps space low.

Retention lives entirely in Hyperbackup, so the script itself never has to delete anything.

## 1. Place the script

Copy `postgres-backup.sh` to the NAS, e.g. `/volume1/scripts/postgres-backup.sh` (File Station, or `scp`).

Over SSH:
```
chmod +x /volume1/scripts/postgres-backup.sh
```

## 2. Edit the config block at the top of the script

- `CONTAINER_NAME` — exact name from Container Manager / `docker ps`
- `DB_USER` — the Postgres role you dump with (often `postgres`)
- `DB_PASSWORD` — only needed if the container requires a password for local connections; leave blank if trust/peer auth is enough
- `BACKUP_DIR` — where dumps land, e.g. `/volume1/docker/postgres-backup`. This is the folder Hyperbackup will point at — put it on your working volume, not on the Backup volume.

Test it once by hand over SSH before scheduling:
```
sudo /volume1/scripts/postgres-backup.sh
cat /volume1/docker/postgres-backup/backup.log
```
Confirm you see `.dump` files per database and no `ERROR` lines. If `docker` isn't found, check the full path with `which docker` and hardcode it in the script.

## 3. Schedule it hourly (DSM Task Scheduler)

Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script

- **General**: Task name "Postgres Hourly Dump", User: `root`
- **Schedule**: Daily, repeat every 1 hour
- **Task Settings** → Run command:
  ```
  bash /volume1/scripts/postgres-backup.sh
  ```
- Optionally enable "Send run details by email" for failure alerts.

Run it manually once (Action → Run) to confirm it works from the scheduler context, not just SSH.

## 4. Point Hyperbackup at the dump folder

Hyperbackup → + → Data backup task

- **Destination**: Local Shared Folder → the Backup share on Storage Pool 4 / Volume 2
- **Source**: the shared folder containing `postgres-backup` (uncheck "Applications" — you only need the file-level folder)
- **Schedule**: enable, run every 1 hour
- **Rotation**: choose **Smart Recycle**. This gives you fine-grained hourly recovery points for the last day, then automatically thins to daily for the rest of your retention window — no manual pruning needed and storage stays small because of block-level dedup.

## 5. Restore, when you need it

```
# Roles
gunzip -c globals.sql.gz | docker exec -i <container> psql -U postgres

# A specific database (creates a fresh empty DB first)
docker exec <container> createdb -U postgres <dbname>
cat <dbname>.dump | docker exec -i <container> pg_restore -U postgres -d <dbname>
```

Pull the desired version out of Hyperbackup first (Hyperbackup → task → Restore → pick the timestamp) before running the restore commands above.

## Note on this setup

Both your live container and the Backup volume are in the same NAS. This protects you against DB corruption, accidental drops, and bad deploys, but not against the NAS itself failing (fire, theft, multi-disk failure). If that risk matters to you, the same Hyperbackup task can add a second destination (external USB or cloud) later without touching the dump script at all.
