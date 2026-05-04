#!/usr/bin/env bash
# Pull fresh ECI data, regenerate insights, and push to GitHub if anything changed.
set -euo pipefail
cd "$(dirname "$0")"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*"; }

log "scraping..."
bun scrape.ts

log "computing insights..."
bun insights.ts

if git diff --quiet results.csv docs/insights.json; then
  log "no changes — skipping commit"
  exit 0
fi

log "committing..."
git add results.csv docs/insights.json
git commit -m "auto: refresh results $(date -u +%Y-%m-%dT%H:%MZ)"

log "pushing..."
git push --quiet

log "done"
