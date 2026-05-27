#!/usr/bin/env bash
# Cache-bust runner. Generates a fresh token and rewrites it across:
#   - every same-origin asset URL (?v=<token>) via fingerprint-urls.py
#   - the <meta name="cb" content="..."> tag if present (visual badge anchor)
#   - the favicon link if it points at /cb-shapes/NN.{svg,webp} (visual badge)
#
# Detects which pieces are installed and bumps only what's there. Runs from the
# project root, or pass --target <dir>.
#
# Composes with the rest of the cache-busting toolkit:
#   - install.sh wires in the anti-cache meta tags and (optionally) the visual badge
#   - watch.sh calls this on every source-file save
#   - references/server-headers.md covers the server-side half (Cache-Control)

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="."
QUIET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --quiet)  QUIET="--quiet"; shift ;;
    --help|-h)
      cat <<EOF
usage: bust.sh [--target <dir>] [--quiet]

Generates a fresh 32-bit hex token and rewrites it across the project's
asset URLs, meta tag, and (if present) favicon. Idempotent per token —
running with no source changes produces the same result.
EOF
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

cd "$TARGET"

# Fresh 32-bit token. od is POSIX, portable across BSD/GNU/macOS.
TOKEN=$(od -An -N4 -tx1 < /dev/urandom | tr -d ' \n')

[[ -z "$QUIET" ]] && echo "▸ bumping cache-bust token to ${TOKEN}"

# ---------- 1. Fingerprint same-origin asset URLs ----------
if [[ -f "$SKILL_DIR/scripts/fingerprint-urls.py" ]]; then
  python3 "$SKILL_DIR/scripts/fingerprint-urls.py" "$TOKEN" --target . $QUIET
fi

# File walker. Returns extension-filtered paths, excluding build/vendor dirs
# and the badge JS (which has a literal `<meta name="cb">` string in a comment).
# Avoids the EXT_FILTER+eval pattern that breaks under glob expansion (e.g. when
# `*.htm` matches nothing and find sees an unparseable token).
walk_source_files() {
  find . -type f \
    \( -name '*.html' -o -name '*.htm' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.ts' -o -name '*.js' \) \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    -not -path '*/dist/*' \
    -not -path '*/build/*' \
    -not -path '*/.next/*' \
    -not -path '*/.nuxt/*' \
    -not -path '*/public/cb-shapes/*' \
    -not -name 'cb-badge.js'
}

SED_INPLACE=(-i.cbbak)

# ---------- 2. Bump the <meta name="cb"> tag content ----------
REWRITTEN=0
while IFS= read -r f; do
  if grep -qE '<meta[^>]*name="cb"[^>]*content="[^"]*"' "$f"; then
    sed "${SED_INPLACE[@]}" -E "s/(<meta[^>]*name=\"cb\"[^>]*content=\")[^\"]*(\")/\1${TOKEN}\2/g" "$f"
    rm -f "${f}.cbbak"
    [[ -z "$QUIET" ]] && echo "  ✓ meta cb bumped in $f"
    REWRITTEN=$((REWRITTEN + 1))
  fi
done < <(walk_source_files)

# ---------- 3. Bump the favicon href to a new cell (if visual badge is installed) ----------
# Leading byte of the token picks the cell (byte mod 64).
B0=$(printf "%d" 0x${TOKEN:0:2})
CELL=$(( B0 % 64 ))
FAVICON=$(printf "%02d" $CELL)

while IFS= read -r f; do
  if grep -qE '/cb-shapes/[0-9]{2}\.(webp|svg)' "$f"; then
    sed "${SED_INPLACE[@]}" -E "s#/cb-shapes/[0-9]{2}(\.(webp|svg))#/cb-shapes/${FAVICON}\1#g" "$f"
    rm -f "${f}.cbbak"
    [[ -z "$QUIET" ]] && echo "  ✓ favicon → /cb-shapes/${FAVICON} in $f"
    REWRITTEN=$((REWRITTEN + 1))
  fi
done < <(walk_source_files)

if [[ -z "$QUIET" ]]; then
  echo ""
  echo "🧛  cache bust complete — token ${TOKEN}"
fi
