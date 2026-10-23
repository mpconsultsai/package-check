#!/usr/bin/env bash
# Next.js stores compiler output in .next/cache. Render does not keep that
# directory, but it does keep $XDG_CACHE_HOME. Shuttle the cache through there
# so the next deploy can reuse it. See https://render.com/docs/deploy-nextjs-app
set -euo pipefail

if [[ "${RENDER:-}" != "true" ]]; then
  exec next build
fi

cache_home="${XDG_CACHE_HOME:-$HOME/.cache}"
saved="${cache_home}/next"

if [[ -d "$saved" ]]; then
  echo "Restoring Next.js build cache"
  mkdir -p .next
  rsync -a "${saved}/" .next/cache
else
  echo "No saved Next.js build cache yet. This build fills it for the next deploy."
fi

next build

echo "Saving Next.js build cache"
mkdir -p "$saved"
rsync -a .next/cache/ "$saved"
