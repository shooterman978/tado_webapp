#!/usr/bin/env bash
# Fix "unable to open database file" for TadoLocal named volume.
#
# Cause: Upstream image runs as uid 1000 (user tado); Docker named volumes are
# created root-owned. SQLite cannot create /data/tado-local.db.
#
# Preferred spike fix is already in docker-compose.yml: user: "0:0".
# Use this script if you prefer keeping user 1000 after chown, or to repair
# an existing volume before recreate.
#
# Usage (inside LXC, from deploy/tadolocal):
#   bash scripts/fix-db-permissions.sh

set -euo pipefail

VOLUME="${TADOLOCAL_VOLUME:-tadolocal-data}"

echo "Chown volume ${VOLUME} → 1000:1000 …"
docker run --rm -v "${VOLUME}:/data" alpine:3.20 chown -R 1000:1000 /data
echo "Done. If compose still has user: \"0:0\", leave it — or switch to user: \"1000:1000\"."
echo "Then: docker compose up -d --force-recreate"
