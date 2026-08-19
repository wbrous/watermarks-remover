#!/usr/bin/env bash
# Reverse install_global_hooks.sh: removes our pre-commit hook, restores any
# hook it chained to, and unsets core.hooksPath if we were the ones who set
# it (leaves it alone if you'd pointed it somewhere we didn't manage).
set -euo pipefail

CONFIG_FILE="${WATERMARKS_REMOVER_GLOBAL_CONFIG:-$HOME/.config/watermarks-remover/global-hooks.conf}"
HOOKS_DIR="$(git config --global --get core.hooksPath 2>/dev/null || true)"

if [ -z "$HOOKS_DIR" ]; then
  echo "uninstall_global_hooks.sh: core.hooksPath is not set globally — nothing to do." >&2
else
  DEST="$HOOKS_DIR/pre-commit"
  CHAINED="$HOOKS_DIR/pre-commit.pre-watermarks-remover"

  if [ -f "$DEST" ] && grep -q "watermarks-remover-global-hook" "$DEST"; then
    rm -f "$DEST"
    if [ -f "$CHAINED" ]; then
      mv "$CHAINED" "$DEST"
      chmod +x "$DEST"
      echo "uninstall_global_hooks.sh: restored pre-existing hook -> $DEST"
    fi
    if [ -z "$(find "$HOOKS_DIR" -mindepth 1 -maxdepth 1 2>/dev/null)" ]; then
      git config --global --unset core.hooksPath || true
      rmdir "$HOOKS_DIR" 2>/dev/null || true
      echo "uninstall_global_hooks.sh: removed core.hooksPath (dir was managed and now empty)"
    fi
  else
    echo "uninstall_global_hooks.sh: $DEST is not our hook (or already gone) — leaving core.hooksPath alone." >&2
  fi
fi

rm -f "$CONFIG_FILE"
echo "watermarks-remover: global pre-commit hook uninstalled."
