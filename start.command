#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Install Node.js (LTS) from https://nodejs.org, then run this again."; read -r; exit 1; fi
(sleep 1; open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) &
node server.js
