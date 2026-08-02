#!/usr/bin/env bash
#
# Sync code from the private working copy (the parent folder) into this
# public repo, WITHOUT overwriting the anonymized / public-only files.
#
# Layout this assumes:
#   <private>/            <- your private working copy (parent)
#   <private>/github/     <- this repo (where this script lives)
#
# After running, review with `git diff`, then commit & push.
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # repo root (…/github)
PRIVATE="$(cd "$HERE/.." && pwd)"          # private project (parent)

if [ "$HERE" = "$PRIVATE" ]; then
  echo "Refusing to sync: repo and private copy are the same folder." >&2
  exit 1
fi

echo "Syncing code from: $PRIVATE"
echo "                to: $HERE"
echo

# rsync WITHOUT --delete (never removes OSS-only files). Excludes:
#  - build/deps/secrets/vcs
#  - the repo folder itself (avoid recursion)
#  - files that intentionally DIFFER in the OSS version (anonymized config,
#    README/LICENSE, env examples, this scripts/ dir, package metadata)
rsync -a \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '.firebase' \
  --exclude '*.local' \
  --exclude '.env' \
  --exclude 'github' \
  --exclude '.firebaserc' \
  --exclude '.env.example' \
  --exclude 'functions/.env.example' \
  --exclude 'functions/auth.js' \
  --exclude 'functions/settings.js' \
  --exclude 'src/utils/constants.js' \
  --exclude 'src/components/settings/ZipCodeField.jsx' \
  --exclude 'firebase.json' \
  --exclude 'package.json' \
  --exclude 'README.md' \
  --exclude 'LICENSE' \
  --exclude 'scripts/' \
  "$PRIVATE/" "$HERE/"

echo
echo "Done. Files that intentionally differ were NOT touched:"
echo "  .firebaserc, firebase.json, package.json, functions/auth.js,"
echo "  functions/settings.js, src/utils/constants.js,"
echo "  src/components/settings/ZipCodeField.jsx, README.md, LICENSE,"
echo "  .env examples, scripts/"
echo
echo "If you changed LOGIC (not just values) in any of those, port it by hand."
echo "Next: cd \"$HERE\" && git diff   # review, then commit & push"
