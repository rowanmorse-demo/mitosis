#!/usr/bin/env bash
# Update a Docker deployment of Mitosis in place: pull the latest main and restart the container.
# Usage on the server:  ./deploy.sh        (first time: git clone ... /opt/mitosis && cd /opt/mitosis && docker compose up -d)
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
docker compose up -d --force-recreate
sleep 2
curl -fsS http://127.0.0.1:3000/health && echo
