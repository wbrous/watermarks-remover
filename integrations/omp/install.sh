#!/usr/bin/env bash
# Vendor the /remove-watermarks omp extension into a data directory outside
# this checkout, then copy (not symlink) it into the active omp profile's
# extensions directory, so it keeps working after this checkout is removed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_ROOT/integrations/omp/extensions/remove-watermarks.ts"

if [ ! -f "$SRC" ]; then
  echo "install.sh: missing $SRC (run from a watermarks-remover checkout)" >&2
  exit 1
fi

DATA_HOME="${WATERMARKS_REMOVER_DATA_HOME:-$HOME/.local/share/watermarks-remover}"
mkdir -p "$DATA_HOME/extensions"
cp "$SRC" "$DATA_HOME/extensions/remove-watermarks.ts"

AGENT_DIR="${OMP_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}}"
DEST_DIR="$AGENT_DIR/extensions"
mkdir -p "$DEST_DIR"
rm -f "$DEST_DIR/remove-watermarks.ts"
cp "$DATA_HOME/extensions/remove-watermarks.ts" "$DEST_DIR/remove-watermarks.ts"

echo "watermarks-remover: vendored extension -> $DATA_HOME/extensions/remove-watermarks.ts"
echo "watermarks-remover: installed copy      -> $DEST_DIR/remove-watermarks.ts (independent of $REPO_ROOT)"
echo "Restart omp (or /reload-plugins) to pick up /remove-watermarks."
echo "It needs the same data home as the git hooks — run"
echo "  service/scripts/install_global_hooks.sh"
echo "at least once (or export WATERMARKS_REMOVER_HOME) so it can find audit_dir.py / clean_file.py."
