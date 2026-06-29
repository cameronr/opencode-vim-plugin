#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="${OCV_PLUGIN_TEST_DIR:-$HOME/dev/opencode-vim-plugin-test}"
OPENCODE_BIN="${OPENCODE_BIN:-opencode}"
PLUGIN_ENTRY="$PLUGIN_DIR/dist/tui.js"

if ! command -v "$OPENCODE_BIN" >/dev/null 2>&1; then
  echo "error: opencode not found. Set OPENCODE_BIN=/path/to/opencode." >&2
  exit 1
fi

cd "$PLUGIN_DIR"
bun run build

mkdir -p "$TEST_DIR/.opencode"
cat > "$TEST_DIR/.opencode/tui.json" <<JSON
{
  "plugin": [
    [
      "$PLUGIN_ENTRY",
      {
        "enabled": true,
        "toggle_key": "ctrl+shift+v"
      }
    ]
  ]
}
JSON

cat > "$TEST_DIR/README.md" <<'MD'
# OCV Plugin Local Test Workspace

This workspace loads the local OpenCode Vim Plugin build from `~/dev/opencode-vim-plugin/dist/tui.js`.

Run from this directory with installed OpenCode:

```bash
opencode
```
MD

printf 'Test workspace: %s\n' "$TEST_DIR"
printf 'Plugin entry:   %s\n' "$PLUGIN_ENTRY"
printf 'OpenCode:       %s (%s)\n' "$(command -v "$OPENCODE_BIN")" "$($OPENCODE_BIN --version 2>/dev/null || echo unknown)"
printf '\nLaunching installed OpenCode...\n'
cd "$TEST_DIR"
exec "$OPENCODE_BIN"
