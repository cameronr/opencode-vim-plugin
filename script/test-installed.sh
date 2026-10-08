#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="${OCV_PLUGIN_TEST_DIR:-$HOME/dev/opencode-vim-plugin-test}"
TEST_CONFIG_HOME="${OCV_PLUGIN_TEST_CONFIG_HOME:-$TEST_DIR/.xdg-config}"
TEST_CONFIG_DIR="$TEST_CONFIG_HOME/opencode"
TEST_DATA_HOME="$TEST_DIR/.xdg-data"
TEST_STATE_HOME="$TEST_DIR/.xdg-state"
GLOBAL_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
OPENCODE_BIN="${OPENCODE_BIN:-opencode}"
# OpenCode v2 only loads plugins whose package is a directory (a file path is
# silently skipped by the TUI plugin host), so point at the dist directory.
PLUGIN_ENTRY="$PLUGIN_DIR/dist"

if ! command -v "$OPENCODE_BIN" >/dev/null 2>&1; then
  echo "error: $OPENCODE_BIN not found. Set OPENCODE_BIN=/path/to/opencode." >&2
  exit 1
fi

cd "$PLUGIN_DIR"
bun run build

mkdir -p "$TEST_DIR/.opencode" "$TEST_CONFIG_DIR" "$TEST_DATA_HOME" "$TEST_STATE_HOME"

# Keep the user's provider/plugin configuration, but isolate the global
# cli.json so an installed copy of this plugin cannot shadow the local build
# with the same ID.
if [[ "$GLOBAL_CONFIG_DIR" != "$TEST_CONFIG_DIR" && -d "$GLOBAL_CONFIG_DIR" ]]; then
  shopt -s dotglob nullglob
  for source in "$GLOBAL_CONFIG_DIR"/*; do
    name="$(basename "$source")"
    [[ "$name" == "cli.json" || "$name" == "cli.jsonc" ]] && continue
    [[ -e "$TEST_CONFIG_DIR/$name" || -L "$TEST_CONFIG_DIR/$name" ]] || ln -s "$source" "$TEST_CONFIG_DIR/$name"
  done
  shopt -u dotglob nullglob
fi

cat > "$TEST_CONFIG_DIR/cli.json" <<JSON
{
  "plugins": [
    {
      "package": "$PLUGIN_ENTRY",
      "options": {
        "enabled": true,
        "initial_mode": "normal",
        "toggle_key": "ctrl+shift+v"
      }
    }
  ]
}
JSON

cat > "$TEST_DIR/README.md" <<'MD'
# OCV Plugin Local Test Workspace

This workspace loads the local OpenCode Vim Plugin build from the repo `dist/`
directory and runs OpenCode v2 with a private (`--standalone`) server, so the
test never touches the background service or the live session data.

Run from this directory:

```bash
bash script/test-installed.sh
```
MD

printf 'Test workspace: %s\n' "$TEST_DIR"
printf 'Plugin entry:   %s\n' "$PLUGIN_ENTRY"
printf 'Config home:    %s\n' "$TEST_CONFIG_HOME"
printf 'Data home:      %s\n' "$TEST_DATA_HOME"
printf 'OpenCode:       %s (%s)\n' "$(command -v "$OPENCODE_BIN")" "$($OPENCODE_BIN --version 2>/dev/null || echo unknown)"
printf '\nLaunching OpenCode v2 (--standalone) with global plugins and data isolated...\n'
cd "$TEST_DIR"
exec env XDG_CONFIG_HOME="$TEST_CONFIG_HOME" XDG_DATA_HOME="$TEST_DATA_HOME" XDG_STATE_HOME="$TEST_STATE_HOME" "$OPENCODE_BIN" --standalone
