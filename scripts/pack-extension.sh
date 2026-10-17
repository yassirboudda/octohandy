#!/usr/bin/env bash
# Zips extension/ into public/stockflow-extension.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -r "$ROOT/extension" "$TMP/stockflow-extension"
rm -f "$ROOT/public/stockflow-extension.zip"
(cd "$TMP" && zip -rq "$ROOT/public/stockflow-extension.zip" stockflow-extension)
echo "packed $(unzip -l "$ROOT/public/stockflow-extension.zip" | tail -1)"
