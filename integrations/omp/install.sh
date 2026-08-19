#!/usr/bin/env bash
# Symlink the /remove-watermarks omp extension into the active omp profile's
# extensions directory so it loads on the next omp restart.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_ROOT/integrations/omp/extensions/remove-watermarks.ts"

if [ ! -f "$SRC" ]; then
  echo "install.sh: missing $SRC (run from a watermarks-remover checkout)" >&2
  exit 1
fi

AGENT_DIR="${OMP_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}}"
DEST_DIR="$AGENT_DIR/extensions"
mkdir -p "$DEST_DIR"
ln -sfn "$SRC" "$DEST_DIR/remove-watermarks.ts"

echo "watermarks-remover: linked $DEST_DIR/remove-watermarks.ts -> $SRC"
echo "Restart omp (or /reload-plugins) to pick up /remove-watermarks."
echo "It needs the same checkout config as the git hooks — run"
echo "  service/scripts/install_global_hooks.sh"
echo "at least once (or export WATERMARKS_REMOVER_HOME) so it can find audit_dir.py / clean_file.py."
