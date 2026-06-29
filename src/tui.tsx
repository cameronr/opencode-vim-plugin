/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { createEffect, createSignal, Show, type Accessor } from "solid-js"
import { createPromptVim } from "./prompt-vim"

const PLUGIN_ID = "ocv.vim"
const COMMAND_TOGGLE = "ocv.vim.toggle"
const KV_ENABLED = "ocv.vim.enabled"

type Options = {
  enabled: boolean
  toggleKey?: string
  langmap?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readOptions(input: unknown): Options {
  const options = isRecord(input) ? input : {}
  const enabled = typeof options.enabled === "boolean" ? options.enabled : true
  const toggleKey = typeof options.toggle_key === "string" && options.toggle_key.trim() ? options.toggle_key : undefined
  const langmap = isRecord(options.langmap)
    ? Object.fromEntries(
        Object.entries(options.langmap).filter(
          (entry): entry is [string, string] => entry[0].length === 1 && typeof entry[1] === "string" && entry[1].length === 1,
        ),
      )
    : undefined
  return { enabled, toggleKey, langmap }
}

function isInsertIndicator(indicator: string) {
  return indicator === "-- INSERT --"
}

function isVisualIndicator(indicator: string) {
  return ["-- VISUAL --", "-- VISUAL LINE --", "-- VISUAL BLOCK --"].includes(indicator)
}

function Status(props: {
  indicator: Accessor<string | undefined>
  pending: Accessor<string>
  isVisual: Accessor<boolean>
  applyCursorStyle: () => void
  api: TuiPluginApi
}) {
  createEffect(() => {
    props.indicator()
    props.pending()
    props.isVisual()
    props.applyCursorStyle()
  })

  return (
    <Show when={props.indicator()}>
      {(indicator) => (
        <box paddingLeft={1} flexShrink={0}>
          <text
            fg={
              props.pending()
                ? props.api.theme.current.textMuted
                : isInsertIndicator(indicator())
                  ? props.api.theme.current.accent
                  : isVisualIndicator(indicator())
                    ? props.api.theme.current.text
                    : props.api.theme.current.textMuted
            }
            attributes={props.pending() || props.isVisual() ? TextAttributes.BOLD : undefined}
          >
            {indicator()}
          </text>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api, rawOptions) => {
  const options = readOptions(rawOptions)
  const initialEnabled = api.kv.get(KV_ENABLED, options.enabled)
  const [enabled, setEnabled] = createSignal(initialEnabled)
  const prompt = createPromptVim(api, {
    enabled,
    initialMode: initialEnabled ? "normal" : "insert",
    langmap: () => options.langmap,
  })

  function toggle() {
    const next = !enabled()
    api.kv.set(KV_ENABLED, next)
    setEnabled(next)
    if (next) prompt.setMode("normal")
    api.ui.toast({
      variant: next ? "success" : "info",
      message: next ? "Vim mode enabled" : "Vim mode disabled",
    })
  }

  api.keymap.registerLayer({
    priority: 100,
    commands: [
      {
        name: COMMAND_TOGGLE,
        title: "Toggle vim mode",
        desc: "Enable or disable the OpenCode Vim plugin",
        category: "Plugin",
        namespace: "palette",
        slashName: "vim",
        run() {
          toggle()
          api.ui.dialog.clear()
        },
      },
      ...prompt.commands,
    ],
    bindings: [
      ...(options.toggleKey ? [{ key: options.toggleKey, cmd: COMMAND_TOGGLE, desc: "Toggle vim mode" }] : []),
      ...prompt.bindings,
    ],
  })

  api.slots.register({
    order: 100,
    slots: {
      home_prompt_right() {
        return (
          <Status
            indicator={prompt.indicator}
            pending={prompt.pending}
            isVisual={prompt.isVisual}
            applyCursorStyle={prompt.applyCursorStyle}
            api={api}
          />
        )
      },
      session_prompt_right() {
        return (
          <Status
            indicator={prompt.indicator}
            pending={prompt.pending}
            isVisual={prompt.isVisual}
            applyCursorStyle={prompt.applyCursorStyle}
            api={api}
          />
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
}

export default plugin
