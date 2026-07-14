/** @jsxImportSource @opentui/solid */

import type { KeyEvent, Renderable, TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { TextAttributes } from "@opentui/core"
import type { Binding, KeyLike } from "@opentui/keymap"
import { createEffect, createSignal, Show, type Accessor } from "solid-js"
import { createPromptVim } from "./prompt-vim"

const PLUGIN_ID = "ocv-plugin"
const COMMAND_TOGGLE = "ocv-plugin.toggle"
const KV_ENABLED = "ocv-plugin.enabled"
const NORMAL_LEADER_TOKEN = "ocv-plugin-leader"

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

// Mirrors OpenCode TUI's CommandMap for OCV-style keybind compatibility.
const COMMAND_ALIASES: Record<string, string> = {
  app_exit: "app.exit",
  app_debug: "app.debug",
  app_console: "app.console",
  app_heap_snapshot: "app.heap_snapshot",
  app_toggle_animations: "app.toggle.animations",
  app_toggle_file_context: "app.toggle.file_context",
  app_toggle_diffwrap: "app.toggle.diffwrap",
  app_toggle_paste_summary: "app.toggle.paste_summary",
  app_toggle_session_directory_filter: "app.toggle.session_directory_filter",
  command_list: "command.palette.show",
  help_show: "help.show",
  docs_open: "docs.open",
  diff_open: "diff.open",
  diff_close: "diff.close",
  diff_toggle: "diff.toggle",
  diff_expand: "diff.expand",
  diff_expand_all: "diff.expand_all",
  diff_collapse: "diff.collapse",
  diff_switch_focus: "diff.switch_focus",
  diff_next_hunk: "diff.next_hunk",
  diff_previous_hunk: "diff.previous_hunk",
  diff_next_file: "diff.next_file",
  diff_previous_file: "diff.previous_file",
  diff_toggle_file_tree: "diff.toggle_file_tree",
  diff_single_patch: "diff.single_patch",
  diff_switch_source: "diff.switch_source",
  diff_toggle_view: "diff.toggle_view",
  diff_help: "diff.help",
  editor_open: "prompt.editor",
  theme_list: "theme.switch",
  theme_switch_mode: "theme.switch_mode",
  theme_mode_lock: "theme.mode.lock",
  sidebar_toggle: "session.sidebar.toggle",
  scrollbar_toggle: "session.toggle.scrollbar",
  status_view: "opencode.status",
  debug_view: "opencode.debug",
  session_export: "session.export",
  session_copy: "session.copy",
  copy_mode: "session.copy_mode",
  session_move: "session.move",
  session_new: "session.new",
  session_list: "session.list",
  session_timeline: "session.timeline",
  session_fork: "session.fork",
  session_rename: "session.rename",
  session_delete: "session.delete",
  session_share: "session.share",
  session_unshare: "session.unshare",
  session_interrupt: "session.interrupt",
  session_background: "session.background",
  session_compact: "session.compact",
  session_toggle_timestamps: "session.toggle.timestamps",
  session_toggle_generic_tool_output: "session.toggle.generic_tool_output",
  session_queued_prompts: "session.queued_prompts",
  session_child_first: "session.child.first",
  session_child_cycle: "session.child.next",
  session_child_cycle_reverse: "session.child.previous",
  session_parent: "session.parent",
  session_pin_toggle: "session.pin.toggle",
  session_quick_switch_1: "session.quick_switch.1",
  session_quick_switch_2: "session.quick_switch.2",
  session_quick_switch_3: "session.quick_switch.3",
  session_quick_switch_4: "session.quick_switch.4",
  session_quick_switch_5: "session.quick_switch.5",
  session_quick_switch_6: "session.quick_switch.6",
  session_quick_switch_7: "session.quick_switch.7",
  session_quick_switch_8: "session.quick_switch.8",
  session_quick_switch_9: "session.quick_switch.9",
  stash_delete: "stash.delete",
  model_provider_list: "model.dialog.provider",
  model_favorite_toggle: "model.dialog.favorite",
  model_list: "model.list",
  model_cycle_recent: "model.cycle_recent",
  model_cycle_recent_reverse: "model.cycle_recent_reverse",
  model_cycle_favorite: "model.cycle_favorite",
  model_cycle_favorite_reverse: "model.cycle_favorite_reverse",
  mcp_list: "mcp.list",
  provider_connect: "provider.connect",
  console_org_switch: "console.org.switch",
  agent_list: "agent.list",
  agent_cycle: "agent.cycle",
  agent_cycle_reverse: "agent.cycle.reverse",
  variant_cycle: "variant.cycle",
  variant_list: "variant.list",
  messages_page_up: "session.page.up",
  messages_page_down: "session.page.down",
  messages_line_up: "session.line.up",
  messages_line_down: "session.line.down",
  messages_half_page_up: "session.half.page.up",
  messages_half_page_down: "session.half.page.down",
  messages_first: "session.first",
  messages_last: "session.last",
  messages_next: "session.message.next",
  messages_previous: "session.message.previous",
  messages_last_user: "session.messages_last_user",
  messages_copy: "messages.copy",
  messages_undo: "session.undo",
  messages_redo: "session.redo",
  messages_toggle_conceal: "session.toggle.conceal",
  tool_details: "session.toggle.actions",
  display_thinking: "session.toggle.thinking",
  prompt_submit: "prompt.submit",
  prompt_copy_selection: "prompt.copy_selection",
  prompt_editor_context_clear: "prompt.editor_context.clear",
  prompt_skills: "prompt.skills",
  prompt_stash: "prompt.stash",
  prompt_stash_pop: "prompt.stash.pop",
  prompt_stash_list: "prompt.stash.list",
  workspace_set: "workspace.set",
  input_clear: "prompt.clear",
  input_paste: "prompt.paste",
  input_submit: "input.submit",
  input_newline: "input.newline",
  input_move_left: "input.move.left",
  input_move_right: "input.move.right",
  input_move_up: "input.move.up",
  input_move_down: "input.move.down",
  input_select_left: "input.select.left",
  input_select_right: "input.select.right",
  input_select_up: "input.select.up",
  input_select_down: "input.select.down",
  input_line_home: "input.line.home",
  input_line_end: "input.line.end",
  input_select_line_home: "input.select.line.home",
  input_select_line_end: "input.select.line.end",
  input_visual_line_home: "input.visual.line.home",
  input_visual_line_end: "input.visual.line.end",
  input_select_visual_line_home: "input.select.visual.line.home",
  input_select_visual_line_end: "input.select.visual.line.end",
  input_buffer_home: "input.buffer.home",
  input_buffer_end: "input.buffer.end",
  input_select_buffer_home: "input.select.buffer.home",
  input_select_buffer_end: "input.select.buffer.end",
  input_delete_line: "input.delete.line",
  input_delete_to_line_end: "input.delete.to.line.end",
  input_delete_to_line_start: "input.delete.to.line.start",
  input_backspace: "input.backspace",
  input_delete: "input.delete",
  input_undo: "input.undo",
  input_redo: "input.redo",
  input_word_forward: "input.word.forward",
  input_word_backward: "input.word.backward",
  input_select_word_forward: "input.select.word.forward",
  input_select_word_backward: "input.select.word.backward",
  input_delete_word_forward: "input.delete.word.forward",
  input_delete_word_backward: "input.delete.word.backward",
  input_select_all: "input.select.all",
  history_previous: "prompt.history.previous",
  history_next: "prompt.history.next",
  terminal_suspend: "terminal.suspend",
  terminal_title_toggle: "terminal.title.toggle",
  tips_toggle: "tips.toggle",
  plugin_manager: "plugins.list",
  plugin_install: "plugins.install",
  which_key_toggle: "which-key.toggle",
  which_key_layout_toggle: "which-key.layout.toggle",
  which_key_pending_toggle: "which-key.pending.toggle",
  which_key_group_previous: "which-key.group.previous",
  which_key_group_next: "which-key.group.next",
  which_key_scroll_up: "which-key.scroll.up",
  which_key_scroll_down: "which-key.scroll.down",
  which_key_page_up: "which-key.page.up",
  which_key_page_down: "which-key.page.down",
  which_key_home: "which-key.home",
  which_key_end: "which-key.end",
}

function commandName(value: string) {
  return COMMAND_ALIASES[value] ?? (value.includes(".") ? value : value.replaceAll("_", "."))
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
    prompt.cancelPending()
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
    commands: [
      {
        name: COMMAND_TOGGLE,
        title: "Toggle vim mode",
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
  })

  api.keymap.registerLayer({
    mode: "base",
    priority: 100,
    bindings: [
      ...(options.toggleKey ? [{ key: options.toggleKey, cmd: COMMAND_TOGGLE, desc: "Toggle vim mode" }] : []),
      ...prompt.bindings,
    ],
  })

  if (options.normalBindings.length > 0) {
    api.keymap.registerLayer({
      mode: "base",
      priority: 200,
      enabled: () => prompt.active() && prompt.mode() === "normal",
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
