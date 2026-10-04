#!/usr/bin/env bun

import { rm } from "node:fs/promises"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

await rm("dist", { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  splitting: false,
  sourcemap: "external",
  minify: false,
  plugins: [createSolidTransformPlugin()],
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/tui",
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
  ],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// opencode v2 provides its plugin API at runtime as "@opencode/plugin/tui";
// "@opencode-ai/plugin" is only installed here for types.
const output = "dist/tui.js"
await Bun.write(output, (await Bun.file(output).text()).replaceAll('from "@opencode-ai/plugin/tui"', 'from "@opencode/plugin/tui"'))
