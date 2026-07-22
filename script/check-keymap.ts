#!/usr/bin/env bun

import { registerCommaBindings } from "@opentui/keymap/addons/opentui"
import { createTestKeymap } from "@opentui/keymap/testing"
import { createPromptVim } from "../src/prompt-vim"

const api = {
  ui: { dialog: { open: false } },
  route: { current: { name: "home" } },
  renderer: { currentFocusedEditor: null },
} as any

const prompt = createPromptVim(api, { enabled: () => true, initialMode: "normal", langmap: () => ({ р: "h" }) })
const harness = createTestKeymap({ defaultKeys: true })
const offCommaBindings = registerCommaBindings(harness.keymap)

harness.keymap.registerLayer({
  commands: prompt.commands as any,
  bindings: prompt.bindings as any,
})

const warnings = harness.diagnostics.warnings
const errors = harness.diagnostics.errors
const hasLiteralComma = prompt.bindings.some(
  (binding) => typeof binding.key === "object" && binding.key.name === "," && !binding.key.shift,
)
offCommaBindings()
harness.cleanup()

if (!hasLiteralComma) {
  console.error("missing literal comma binding")
  process.exit(1)
}

if (warnings.length || errors.length) {
  for (const warning of warnings) console.warn(warning)
  for (const error of errors) console.error(error)
  process.exit(1)
}

console.log(`ok: ${prompt.bindings.length} vim key bindings compile`)
