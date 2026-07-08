/** @jsxImportSource @opentui/solid */

import type { KeyEvent, Renderable, TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { TextAttributes } from "@opentui/core"
import type { Binding, KeyLike } from "@opentui/keymap"
import { createEffect, createSignal, Show, type Accessor } from "solid-js"
import { createPromptVim } from "./prompt-vim"

const PLUGIN_ID = "ocv.vim"
const COMMAND_TOGGLE = "ocv.vim.toggle"
const KV_ENABLED = "ocv.vim.enabled"
const NORMAL_LEADER_TOKEN = "ocv-vim-leader"

type NormalBinding = Binding<Renderable, KeyEvent> & { cmd: string }

type Options = {
  enabled: boolean
  toggleKey?: string
  indicator: boolean
  enterSubmit: boolean
  insertAfterSubmit: boolean
  systemClipboardRegister: boolean
  langmap?: Record<string, string>
  normalLeader?: string
  normalBindings: NormalBinding[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function commandName(value: string) {
  return value.includes(".") ? value : value.replaceAll("_", ".")
}

function normalBindingKey(key: KeyLike, normalLeader: string | undefined): KeyLike {
  if (!normalLeader || typeof key !== "string") return key
  return key.replaceAll("<leader>", `<${NORMAL_LEADER_TOKEN}>`)
}

function bindingFromValue(command: string, value: unknown, normalLeader: string | undefined): NormalBinding[] {
  const key = nonEmptyString(value)
  if (key) return key === "none" ? [] : [{ key: normalBindingKey(key, normalLeader), cmd: command }]
  if (!Array.isArray(value)) {
    if (!isRecord(value)) return []
    const itemKey = nonEmptyString(value.key)
    if (!itemKey || itemKey === "none") return []
    return [
      {
        key: normalBindingKey(itemKey, normalLeader),
        cmd: command,
        ...(typeof value.preventDefault === "boolean" ? { preventDefault: value.preventDefault } : {}),
        ...(typeof value.desc === "string" ? { desc: value.desc } : {}),
      },
    ]
  }
  return value.flatMap((item) => bindingFromValue(command, item, normalLeader))
}

function readNormalBindings(options: Record<string, unknown>, normalLeader: string | undefined) {
  const direct = isRecord(options.normal_keybinds)
    ? Object.entries(options.normal_keybinds).flatMap(([key, value]) => {
        if (typeof value === "string") return [{ key: normalBindingKey(key, normalLeader), cmd: commandName(value) }]
        if (!isRecord(value)) return []
        const command = nonEmptyString(value.command) ?? nonEmptyString(value.cmd)
        if (!command) return []
        return [
          {
            key: normalBindingKey(key, normalLeader),
            cmd: commandName(command),
            ...(typeof value.preventDefault === "boolean" ? { preventDefault: value.preventDefault } : {}),
            ...(typeof value.desc === "string" ? { desc: value.desc } : {}),
          },
        ]
      })
    : []
  const keybinds = isRecord(options.keybinds) && isRecord(options.keybinds["vim.normal"]) ? options.keybinds["vim.normal"] : undefined
  const scoped = keybinds
    ? Object.entries(keybinds).flatMap(([name, value]) => (name === "leader" ? [] : bindingFromValue(commandName(name), value, normalLeader)))
    : []
  return [...direct, ...scoped]
}

function readOptions(input: unknown): Options {
  const options = isRecord(input) ? input : {}
  const enabled = typeof options.enabled === "boolean" ? options.enabled : true
  const toggleKey = nonEmptyString(options.toggle_key)
  const indicator = options.indicator === false || options.indicator === "off" ? false : true
  const enterSubmit = options.enter_submit === true || options.vim_enter_submit === true
  const insertAfterSubmit = options.insert_after_submit === true || options.vim_insert_after_submit === true
  const systemClipboardRegister =
    options.system_clipboard_register === true || options.vim_system_clipboard_register === true
  const langmapInput = isRecord(options.langmap) ? options.langmap : isRecord(options.vim_langmap) ? options.vim_langmap : undefined
  const langmap = langmapInput
    ? Object.fromEntries(
        Object.entries(langmapInput).filter(
          (entry): entry is [string, string] => entry[0].length === 1 && typeof entry[1] === "string" && entry[1].length === 1,
        ),
      )
    : undefined
  const keybinds = isRecord(options.keybinds) && isRecord(options.keybinds["vim.normal"]) ? options.keybinds["vim.normal"] : undefined
  const normalLeader = nonEmptyString(options.normal_leader) ?? nonEmptyString(options.vim_normal_leader) ?? nonEmptyString(keybinds?.leader)
  return {
    enabled,
    toggleKey,
    indicator,
    enterSubmit,
    insertAfterSubmit,
    systemClipboardRegister,
    langmap,
    normalLeader,
    normalBindings: readNormalBindings(options, normalLeader),
  }
}

function Status(props: {
  indicator: Accessor<string | undefined>
  pending: Accessor<string>
  isVisual: Accessor<boolean>
  showIndicator: boolean
  applyCursorStyle: () => void
  api: TuiPluginApi
}) {
  createEffect(() => {
    props.indicator()
    props.pending()
    props.isVisual()
    props.applyCursorStyle()
  })

  if (!props.showIndicator) return null

  return (
    <Show when={props.indicator()}>
      {(indicator) => (
        <box paddingLeft={1} flexShrink={0}>
          <text fg={props.api.theme.current.textMuted} attributes={props.pending() || props.isVisual() ? TextAttributes.BOLD : undefined}>
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
    enterSubmit: options.enterSubmit,
    insertAfterSubmit: options.insertAfterSubmit,
    systemClipboardRegister: options.systemClipboardRegister,
    langmap: () => options.langmap,
  })
  api.lifecycle.onDispose(prompt.dispose)

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

  if (options.normalLeader && options.normalBindings.length > 0) {
    api.keymap.registerToken({ name: NORMAL_LEADER_TOKEN, key: options.normalLeader })
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

  if (options.normalBindings.length > 0) {
    api.keymap.registerLayer({
      priority: 200,
      enabled: () => enabled() && prompt.mode() === "normal",
      bindings: options.normalBindings,
    })
  }

  api.slots.register({
    order: 100,
    slots: {
      home_prompt_right() {
        return (
          <Status
            indicator={prompt.indicator}
            pending={prompt.pending}
            isVisual={prompt.isVisual}
            showIndicator={options.indicator}
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
            showIndicator={options.indicator}
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
