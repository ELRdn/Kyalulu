#!/bin/bash
# Install root-owned at /usr/local/sbin/kyalulu-backup.
set -euo pipefail
umask 077
exec 9>/run/lock/kyalulu-backup.lock
flock -n 9 || exit 0
recipient_file=/etc/kyalulu/backup-recipient.txt
backup_dir=/var/backups/kyalulu
test -s "$recipient_file"
install -d -m 700 "$backup_dir"
tmp=$(mktemp "$backup_dir/.snapshot.XXXXXXXX.age")
trap 'rm -f -- "$tmp"' EXIT
# Snapshot committed WAL data in RAM; send only ciphertext to persistent storage.
docker exec -i kyalulu-remote-relay-1 python - <<'PY' | age -R "$recipient_file" > "$tmp"
import sqlite3, sys
from contextlib import closing
with closing(sqlite3.connect('file:/data/relay.sqlite3?mode=ro', uri=True)) as source:
    with closing(sqlite3.connect(':memory:')) as snapshot:
        source.backup(snapshot)
        if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('snapshot integrity failed')
        tables = {r[0] for r in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'owners', 'devices', 'tickets'} <= tables:
            raise RuntimeError('unexpected schema')
        sys.stdout.buffer.write(snapshot.serialize())
PY
test -s "$tmp"
mv -n -- "$tmp" "$backup_dir/relay-$(date -u +%Y%m%dT%H%M%S)-$$.sqlite3.age"
# Retain 30 days; only this script's regular backup files are eligible.
find "$backup_dir" -maxdepth 1 -type f -name 'relay-????????T??????-*.sqlite3.age' -mtime +30 -delete
echo 'Encrypted Relay snapshot completed.'
