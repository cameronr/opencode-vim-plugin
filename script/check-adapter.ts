#!/usr/bin/env bun

import { RendererContext } from "@opentui/solid"
import { createComponent, createRoot } from "solid-js"

export {}

// Minimal stand-in for the host CliRenderer. Element construction and tree
// wiring only need a handful of members; anything else is a no-op since the
// harness never renders pixels.
const FAKE_RENDERER_TARGET: Record<string, unknown> = { width: 80, height: 24 }
const FAKE_RENDERER = new Proxy(FAKE_RENDERER_TARGET, {
  get(target, prop) {
    if (typeof prop === "symbol") return Reflect.get(target, prop)
    if (prop in target) return target[prop]
    return () => {}
  },
}) as unknown as import("@opentui/core").CliRenderer

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// Mirrors the host v2 default binding parser's accept/reject rules so the
// harness catches unbindable keys the plugin mistakenly emits. A bind is a
// comma-separated list of entries; each entry may carry <token> aliases and
// {patterns}, then one key (a single char, a named key, or an f-key) with
// optional leading modifiers. A lone < (no >) or { (no }) is the literal key,
// since the parser only treats <...>/{...} as a token/pattern when closed. It
// throws on empty comma entries, a trailing modifier with no key, multiple key
// names, and keys that are neither a char, named key, nor f-key.
const NAMED_KEYS = new Set([
  "up",
  "down",
  "left",
  "right",
  "clear",
  "escape",
  "return",
  "linefeed",
  "enter",
  "tab",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "space",
  "lt",
  "gt",
  "plus",
  "minus",
  "equal",
  "comma",
  "period",
  "slash",
  "backslash",
  "semicolon",
  "quote",
  "backquote",
  "leftbracket",
  "rightbracket",
  "capslock",
  "numlock",
  "scrolllock",
  "printscreen",
  "pause",
  "menu",
  "apps",
  "kp0",
  "kp1",
  "kp2",
  "kp3",
  "kp4",
  "kp5",
  "kp6",
  "kp7",
  "kp8",
  "kp9",
  "kpdecimal",
  "kpdivide",
  "kpmultiply",
  "kpminus",
  "kpplus",
  "kpenter",
  "kpequal",
  "kpseparator",
  "kpleft",
  "kpright",
  "kpup",
  "kpdown",
  "kppageup",
  "kppagedown",
  "kphome",
  "kpend",
  "kpinsert",
  "kpdelete",
  "mediaplay",
  "mediapause",
  "mediaplaypause",
  "mediareverse",
  "mediastop",
  "mediafastforward",
  "mediarewind",
  "medianext",
  "mediaprev",
  "mediarecord",
  "volumedown",
  "volumeup",
  "mute",
  "leftshift",
  "leftctrl",
  "leftalt",
  "leftsuper",
  "lefthyper",
  "leftmeta",
  "rightshift",
  "rightctrl",
  "rightalt",
  "rightsuper",
  "righthyper",
  "rightmeta",
  "iso_level3_shift",
  "iso_level5_shift",
  "option",
  "alt",
  "meta",
  "super",
  "hyper",
  "control",
  "ctrl",
  "shift",
])
const MODIFIERS = new Set(["ctrl", "control", "shift", "meta", "alt", "option", "super", "hyper"])

function parseKeyEntry(entry: string) {
  let rest = entry
  for (;;) {
    if (rest.startsWith("<")) {
      const end = rest.indexOf(">")
      if (end === -1) {
        rest = rest.slice(1)
        break
      }
      rest = rest.slice(end + 1)
      continue
    }
    if (rest.startsWith("{")) {
      const end = rest.indexOf("}")
      if (end === -1) {
        rest = rest.slice(1)
        break
      }
      rest = rest.slice(end + 1)
      continue
    }
    break
  }
  if (rest === "" || rest === "+" || rest === " ") return
  let name = ""
  for (const raw of rest.split("+")) {
    const part = raw.trim()
    if (!part) continue
    if (MODIFIERS.has(part.toLowerCase())) continue
    if (name) throw new Error(`Invalid key "${entry}": multiple key names are not supported`)
    name = part
  }
  if (!name) throw new Error(`Invalid key "${entry}": missing key name`)
  const lower = name.toLowerCase()
  if (name.length !== 1 && !NAMED_KEYS.has(lower) && !/^f\d{1,2}$/.test(lower)) {
    throw new Error(`Invalid key "${entry}": unknown key "${name}"`)
  }
}

function parseBind(bind: string) {
  for (const part of bind.split(",")) {
    if (!part) throw new Error("comma-separated bindings cannot contain empty entries")
    parseKeyEntry(part)
  }
}

function fakeTextarea() {
  return {
    plainText: "",
    cursorOffset: 0,
    focused: true,
    editBuffer: {
      offsetToPosition(offset: number) {
        return { row: 0, col: offset }
      },
    },
    editorView: {
      selection: null as { start: number; end: number } | null,
      getSelection() {
        return this.selection
      },
      setSelection(start: number, end: number) {
        this.selection = { start, end }
      },
      resetSelection() {
        this.selection = null
      },
    },
    visualCursor: { visualRow: 0, visualCol: 0 },
    height: 1,
    width: 80,
    y: 0,
    x: 0,
    selectionBg: undefined,
    selectionFg: undefined,
    showCursor: true,
    cursorStyle: undefined,
    onPaste: undefined as ((event: any) => void) | undefined,
    insertText(text: string) {
      this.plainText = this.plainText.slice(0, this.cursorOffset) + text + this.plainText.slice(this.cursorOffset)
      this.cursorOffset += text.length
    },
    deleteRange(_startRow: number, startCol: number, _endRow: number, endCol: number) {
      this.plainText = this.plainText.slice(0, startCol) + this.plainText.slice(endCol)
      this.cursorOffset = startCol
    },
    setText(text: string) {
      this.plainText = text
      this.cursorOffset = text.length
    },
    clear() {
      this.setText("")
    },
    submit() {},
    gotoBufferHome() {
      this.cursorOffset = 0
    },
    gotoBufferEnd() {
      this.cursorOffset = this.plainText.length
    },
    moveCursorUp() {
      if (this.visualCursor.visualRow <= 0) return false
      this.visualCursor.visualRow--
      this.cursorOffset--
      return true
    },
    moveCursorDown() {
      if (this.visualCursor.visualRow >= this.height - 1) return false
      this.visualCursor.visualRow++
      this.cursorOffset++
      return true
    },
    render() {},
    getLayoutNode() {
      return { markDirty() {} }
    },
    requestRender() {},
    updateSelectionForMovement() {},
    clearSelection() {
      this.editorView.resetSelection()
    },
  }
}

function fakeEvent(name: string, opts: { shift?: boolean; sequence?: string } = {}) {
  return {
    name,
    sequence: opts.sequence ?? name,
    raw: opts.sequence ?? name,
    ctrl: false,
    meta: false,
    super: false,
    shift: opts.shift ?? false,
    preventDefault() {},
    stopPropagation() {},
  }
}

function fakeContext(options: unknown) {
  const layers: any[] = []
  const slots: any[] = []
  const dispatched: string[] = []
  const toasts: any[] = []
  const context: any = {
    options,
    location: undefined,
    app: { version: "test", channel: "test" },
    renderer: { currentFocusedEditor: null, requestRender() {} },
    client: {},
    data: {},
    attention: { notify: async () => ({ ok: true, notification: false, sound: false }) },
    theme: {
      text: {
        default: { r: 255, g: 255, b: 255, a: 1, buffer: new Uint16Array(4) },
        subdued: { r: 128, g: 128, b: 128, a: 1, buffer: new Uint16Array(4) },
      },
      background: { default: { r: 0, g: 0, b: 0, a: 1, buffer: new Uint16Array(4) } },
      hue: { accent: { 300: { r: 100, g: 150, b: 200, a: 1, buffer: new Uint16Array(4) } } },
    },
    themeMode: "dark",
    markdown: { registerCodeBlockRenderer: () => () => {} },
    keymap: {
      layer(input: () => any) {
        const layer = input()
        for (const command of layer.commands ?? []) if (command.bind) parseBind(command.bind)
        layers.push(layer)
        return () => {}
      },
      dispatch(id: string) {
        dispatched.push(id)
      },
      shortcuts: () => [],
      commands: () => [],
      pending: () => [],
      active: () => [],
      mode: { current: () => "base", push: () => () => {} },
    },
    storage: {
      store(_key: string, { initial }: { initial: any }) {
        const state: any = { ...initial }
        return [state, (mutate: (draft: any) => void) => {
          mutate(state)
          return Promise.resolve()
        }]
      },
      memory(_key: string, { initial }: { initial: any }) {
        const state: any = { ...initial }
        return [state, (mutate: (draft: any) => void) => mutate(state)]
      },
    },
    ui: {
      dialog: { show() {}, set() {}, clear() {} },
      toast: { show(toast: any) { toasts.push(toast) } },
      format: { path: (value: string) => value },
      router: { register: () => () => {}, navigate() {}, current: () => ({ type: "home" }) },
      tabs: { enabled: () => false, list: () => [], open: () => false, focus: () => false, close: () => false },
      slot(claim: any) {
        slots.push(claim)
        // The host TUI renders slot claims inside a reactive root backed by
        // the CliRenderer; the plugin registers its keymap layers from that
        // render (KeymapSetup). Mirror that with a fake renderer context.
        createRoot(() => {
          createComponent(RendererContext.Provider, {
            value: FAKE_RENDERER,
            get children() {
              return claim.render()
            },
          })
        })
        return () => {}
      },
    },
  }
  return { context, layers, slots, dispatched, toasts }
}

async function setup(options: unknown = { initial_mode: "normal" }) {
  const plugin = ((await import("../dist/tui.js" as string)) as any).default
  const { context, layers, slots, dispatched, toasts } = fakeContext(options)
  const cleanup = await plugin.setup(context)
  return { context, layers, slots, dispatched, toasts, cleanup }
}

// Finds the inline vim key command for a bind and runs it. The host engine
// calls run with no arguments, so the command rebuilds its event from the
// bind. Returning false means the key fell through to the host; anything else
// consumed it.
function vimKey(layers: any[], bind: string) {
  const command = layers
    .filter((layer) => layer.mode === "base" && layer.priority === 100)
    .flatMap((layer) => layer.commands ?? [])
    .find((command: any) => command.bind === bind)
  assert(command, `vim key command for "${bind}" was not registered`)
  return (_event?: any) => command.run()
}

{
  const { layers, context, dispatched } = await setup({
    initial_mode: "normal",
    normal_keybinds: {
      "<leader>s": "session.list",
      y: "messages_line_up",
      u: "messages_undo",
      r: "messages_redo",
      m: "messages_last_user",
      t: "tool_details",
      n: "session_child_cycle",
      p: "session_child_cycle_reverse",
      j: { command: "session.line.down", desc: "Scroll down", preventDefault: false },
    },
  })
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  assert(normalLayer.mode === "base", "normal keybind layer should be base-mode only")
  const byBind = (bind: string) => normalLayer.commands.find((command: any) => command.bind === bind)
  assert(byBind("<leader>s"), "leader bindings should keep the host <leader> token")
  assert(byBind("y").run() === false, "normal keybinds should fall through without a focused prompt")
  assert(dispatched.length === 0, "normal keybinds should not dispatch without a focused prompt")
  context.renderer.currentFocusedEditor = fakeTextarea()
  for (const [bind, command] of Object.entries({
    "<leader>s": "session.list",
    y: "session.line.up",
    u: "session.undo",
    r: "session.redo",
    m: "session.messages_last_user",
    t: "session.toggle.actions",
    n: "session.child.next",
    p: "session.child.previous",
    j: "session.line.down",
  })) {
    dispatched.length = 0
    byBind(bind).run()
    assert(dispatched.at(-1) === command, `OCV-style command alias ${command} was not resolved for ${bind}`)
  }
}

{
  const { layers, context } = await setup({
    enabled: true,
    normal_keybinds: { q: "session.list" },
  })
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  const editor: any = fakeTextarea()
  const originalInsertText = editor.insertText
  context.renderer.currentFocusedEditor = editor
  const q = normalLayer.commands.find((command: any) => command.bind === "q")
  assert(q.run() === false, "Vim should start in insert mode by default")
  assert(editor.insertText !== originalInsertText, "initial insert mode should start the repeat recorder")
  editor.insertText("abc")
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "", "initial insert text should be undoable")
  vimKey(layers, ".")()
  assert(editor.plainText === "abc", "initial insert text should be repeatable")
}

{
  const { layers, context } = await setup({
    enabled: true,
    vim_initial_mode: "normal",
    normal_keybinds: { q: "session.list" },
  })
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  context.renderer.currentFocusedEditor = fakeTextarea()
  const q = normalLayer.commands.find((command: any) => command.bind === "q")
  assert(q.run() !== false, "vim_initial_mode normal should start Vim in normal mode")
}

{
  const { layers, context, dispatched, cleanup, slots } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.id === "ocv-plugin.toggle"))
  assert(commandLayer?.mode === undefined, "vim palette commands should remain reachable while autocomplete is open")
  const vimLayer = layers.find((layer) => layer.priority === 100 && layer.commands?.some((command: any) => command.bind === "h"))
  assert(vimLayer?.mode === "base", "vim key bindings should be inactive while autocomplete is open")
  const toggle = commandLayer?.commands.find((command: any) => command.id === "ocv-plugin.toggle")
  assert(toggle?.slash?.name === "vim", "toggle command should expose /vim")
  assert(toggle?.palette === true, "the toggle command should be reachable from OpenCode's command palette")
  const quit = commandLayer?.commands.find((command: any) => command.id === "ocv-plugin.quit")
  assert(quit?.title === "Quit" && quit.group === "System", "the command palette should expose the OCV-style Quit command")
  assert(quit?.slash === undefined, "the plugin should leave OpenCode's /q slash alias unchanged")
  assert(quit?.palette === true, "the plugin Quit command should be reachable from OpenCode's command palette")
  assert(slots.some((claim) => claim.append === "prompt.footer.status"), "the status indicator should claim the prompt footer status slot")

  const editor: any = fakeTextarea()
  const defaultCursorStyle = { style: "block", blinking: false }
  const defaultSelectionBg = { name: "default-selection-bg" }
  const defaultSelectionFg = { name: "default-selection-fg" }
  editor.cursorStyle = defaultCursorStyle
  editor.selectionBg = defaultSelectionBg
  editor.selectionFg = defaultSelectionFg
  const originalRender = editor.render
  const originalClear = editor.clear
  const originalSubmit = editor.submit
  const originalPaste = editor.onPaste
  context.renderer.currentFocusedEditor = editor
  // Consumption is asserted via the run return value: void = consumed by the
  // plugin layer, false = fell through to the host.
  const colonHandled = vimKey(layers, "shift+;")()
  assert(colonHandled !== false, "shift+; should be handled as :")
  assert(dispatched.at(-1) === "command.palette.show", "plain : should open the command palette")
  const paletteDispatches = dispatched.length

  editor.plainText = "a:b"
  editor.cursorOffset = 0
  vimKey(layers, "f")()
  vimKey(layers, "shift+;")()
  assert(editor.cursorOffset === 1, "f: should find the next colon")
  assert(dispatched.length === paletteDispatches, "f: should not open the command palette")

  editor.plainText = "ab:c"
  editor.cursorOffset = 0
  vimKey(layers, "t")()
  vimKey(layers, "shift+;")()
  assert(editor.cursorOffset === 1, "t: should move until the next colon")

  editor.plainText = "abc"
  editor.cursorOffset = 1
  vimKey(layers, "r")()
  vimKey(layers, "shift+;")()
  assert(editor.plainText === "a:c", "r: should replace the current character with a colon")

  editor.plainText = "ab:cd"
  editor.cursorOffset = 0
  vimKey(layers, "d")()
  vimKey(layers, "f")()
  vimKey(layers, "shift+;")()
  assert(editor.plainText === "cd", "df: should delete through the next colon")

  editor.plainText = "word"
  editor.cursorOffset = 0
  vimKey(layers, "d")()
  vimKey(layers, "shift+;")()
  vimKey(layers, "w")()
  assert(editor.plainText === "word" && editor.cursorOffset === 4, "an invalid d: should not leave a pending delete")
  assert(dispatched.length === paletteDispatches, "an operator-pending : should not open the command palette")

  editor.plainText = ""
  editor.cursorOffset = 0

  const handled = vimKey(layers, "/")()
  assert(handled !== false, "empty slash should be handled")
  assert(
    editor.plainText === "",
    "slash should be a no-op in normal mode when the plugin reports no autocomplete list (autocomplete: () => false)",
  )
  assert(editor.render !== originalRender, "focused prompt render should be patched for block cursor drawing")
  vimKey(layers, "escape")()
  const originalInsertText = editor.insertText
  vimKey(layers, "i")()
  assert(editor.insertText !== originalInsertText, "insert mode should install the repeat recorder")
  assert(editor.cursorStyle?.style === "line", "enabled insert mode should use the Vim cursor style")
  toggle.run()
  assert(editor.showCursor === true, "disabling Vim should restore the prompt cursor visibility")
  assert(editor.cursorStyle === defaultCursorStyle, "disabling Vim should restore the prompt cursor style")
  assert(editor.selectionBg === defaultSelectionBg, "disabling Vim should restore the prompt selection background")
  assert(editor.selectionFg === defaultSelectionFg, "disabling Vim should restore the prompt selection foreground")
  await cleanup?.()
  assert(editor.render === originalRender, "prompt cleanup should restore patched render")
  assert(editor.clear === originalClear, "prompt cleanup should restore patched clear")
  assert(editor.submit === originalSubmit, "prompt patching should leave submit unchanged")
  assert(editor.onPaste === originalPaste, "prompt cleanup should restore patched paste")
  assert(editor.insertText === originalInsertText, "prompt cleanup should restore repeat recorder methods")
}

{
  const { layers, context } = await setup()
  const toggle = layers
    .flatMap((layer) => layer.commands ?? [])
    .find((command: any) => command.id === "ocv-plugin.toggle")
  const editor = fakeTextarea()
  editor.plainText = "a\nb"
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "d")()
  vimKey(layers, "g")()
  toggle.run()
  toggle.run()
  vimKey(layers, "g")()
  vimKey(layers, "j")()
  assert(editor.plainText === "a\nb", "toggling Vim should clear handler-private pending operator state")
}

{
  const { layers, context, dispatched } = await setup()
  context.renderer.currentFocusedEditor = fakeTextarea()

  vimKey(layers, "shift+g")(fakeEvent("g", { shift: true, sequence: "G" }))
  assert(dispatched.at(-1) === "session.last", "G on an empty prompt should jump to the last session message")

  vimKey(layers, "g")()
  vimKey(layers, "g")()
  assert(dispatched.at(-1) === "session.first", "gg on an empty prompt should jump to the first session message")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  editor.height = 5
  editor.visualCursor.visualRow = 2
  editor.cursorOffset = 2
  context.renderer.currentFocusedEditor = editor

  const shifted = (name: string, sequence: string) => fakeEvent(name, { shift: true, sequence })

  vimKey(layers, "shift+h")(shifted("h", "H"))
  assert(editor.visualCursor.visualRow === 0, "H should jump to the top prompt viewport row")
  vimKey(layers, "shift+l")(shifted("l", "L"))
  assert(editor.visualCursor.visualRow === 4, "L should jump to the bottom prompt viewport row")
  vimKey(layers, "shift+m")(shifted("m", "M"))
  assert(editor.visualCursor.visualRow === 2, "M should jump to the middle prompt viewport row")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  editor.plainText = "draft"
  editor.submit = () => {
    editor.clear()
    return true
  }
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "x")()
  vimKey(layers, "return")(fakeEvent("return"))
  vimKey(layers, "u")()
  assert(editor.plainText === "", "submitting should clear Vim undo history from the previous prompt")
}

{
  const { layers, context } = await setup({ initial_mode: "normal", insert_after_submit: true })
  const editor: any = fakeTextarea()
  const originalInsertText = editor.insertText
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "i")()
  editor.insertText("draft")
  editor.clear()
  assert(editor.insertText !== originalInsertText, "insert_after_submit should restart the repeat recorder")
  editor.insertText("abc")
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "", "insert_after_submit text should be undoable without restoring prior prompt history")
  vimKey(layers, ".")()
  assert(editor.plainText === "abc", "insert_after_submit text should be repeatable")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  editor.plainText = "draft"
  editor.submit = () => true
  const originalInsertText = editor.insertText
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "x")()
  editor.submit()
  vimKey(layers, "u")()
  assert(editor.plainText === "draft", "a rejected submission should preserve Vim undo history")

  vimKey(layers, "i")()
  editor.insertText("!")
  editor.submit()
  assert(editor.insertText !== originalInsertText, "a rejected submission should keep the repeat recorder active")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  const stats: { nativePastes: number } = { nativePastes: 0 }
  editor.onPaste = () => stats.nativePastes++
  context.renderer.currentFocusedEditor = editor
  let prevented = false
  const pasteEvent = {
    preventDefault() {
      prevented = true
    },
    stopPropagation() {},
  }

  vimKey(layers, "h")()
  editor.onPaste(pasteEvent)
  assert(prevented && stats.nativePastes === 0, "bracketed paste should be blocked in normal mode")
  vimKey(layers, "i")()
  editor.onPaste(pasteEvent)
  assert(Boolean(stats.nativePastes), "bracketed paste should reach the editor in insert mode")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  const stats = { layoutRefreshes: 0, renderRequests: 0 }
  const layoutRefreshes = () => stats.layoutRefreshes
  const renderRequests = () => stats.renderRequests
  let resolveHostPaste: (() => void) | undefined
  editor.getLayoutNode = () => ({ markDirty: () => stats.layoutRefreshes++ })
  editor.onPaste = () =>
    new Promise<void>((resolve) => {
      resolveHostPaste = resolve
    })
  context.renderer.currentFocusedEditor = editor
  context.renderer.requestRender = () => stats.renderRequests++

  vimKey(layers, "i")()
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(layoutRefreshes() === 0, "paste layout refresh should wait for the host paste handler")
  resolveHostPaste?.()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(layoutRefreshes() === 1, "completed pastes should refresh the prompt layout")
  assert(renderRequests() === 1, "completed pastes should request a render after refreshing the prompt layout")
}

{
  const { layers, context } = await setup({ initial_mode: "normal", vim_langmap: { р: "h" } })
  const editor: any = fakeTextarea()
  editor.plainText = "word"
  editor.cursorOffset = 2
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "р")(fakeEvent("р"))
  assert(editor.cursorOffset === 1, "non-ASCII langmap keys should reach the Vim handler")
}

{
  const { layers, context } = await setup()
  const first: any = fakeTextarea()
  first.plainText = "old"
  const second: any = fakeTextarea()
  second.plainText = "new"

  context.renderer.currentFocusedEditor = first
  vimKey(layers, "x")()
  context.renderer.currentFocusedEditor = second
  vimKey(layers, "u")()
  assert(second.plainText === "new", "switching prompt editors should isolate Vim undo history")
}

{
  const { layers, context, cleanup } = await setup()
  const first: any = fakeTextarea()
  const firstRender = first.render
  const second: any = fakeTextarea()
  const secondRender = second.render

  context.renderer.currentFocusedEditor = first
  vimKey(layers, "x")()
  assert(first.render !== firstRender, "first prompt editor should be patched")
  first.isDestroyed = true
  context.renderer.currentFocusedEditor = second
  vimKey(layers, "x")()
  assert(second.render !== secondRender, "second prompt editor should be patched")
  await cleanup?.()
  assert(first.render !== firstRender, "destroyed prompt editors should be pruned before cleanup")
  assert(second.render === secondRender, "live prompt editors should still be restored on cleanup")
}

{
  const { layers, context } = await setup()

  const visualFirst: any = fakeTextarea()
  visualFirst.plainText = "old"
  const visualSecond: any = fakeTextarea()
  visualSecond.plainText = "new"
  visualSecond.cursorOffset = 1
  context.renderer.currentFocusedEditor = visualFirst
  vimKey(layers, "v")()
  vimKey(layers, "l")()
  assert(visualFirst.editorView.getSelection(), "visual mode should select text in the first editor")
  context.renderer.currentFocusedEditor = visualSecond
  vimKey(layers, "x")()
  assert(!visualFirst.editorView.getSelection(), "switching editors should clear the previous visual selection")
  assert(visualSecond.plainText === "nw", "switching editors should leave visual mode before handling the next key")

  const replaceFirst: any = fakeTextarea()
  replaceFirst.plainText = "old"
  const replaceSecond: any = fakeTextarea()
  replaceSecond.plainText = "new"
  replaceSecond.cursorOffset = 1
  context.renderer.currentFocusedEditor = replaceFirst
  vimKey(layers, "shift+r")(fakeEvent("r", { shift: true, sequence: "R" }))
  vimKey(layers, "x")()
  context.renderer.currentFocusedEditor = replaceSecond
  vimKey(layers, "z")()
  assert(replaceSecond.plainText === "new", "switching editors should leave replace mode before handling the next key")
}

{
  const plugin = ((await import("../dist/tui.js" as string)) as any).default
  const { context, layers, toasts } = fakeContext({ toggle_key: "ctrl+", normal_leader: "space", normal_keybinds: { "<broken": "session.list" } })
  await plugin.setup(context)
  assert(
    layers.some((layer) => layer.commands?.some((command: any) => command.bind === "h")),
    "invalid user keybind config should not prevent core vim bindings from registering",
  )
  assert(
    layers.some((layer) => layer.commands?.some((command: any) => command.id === "ocv-plugin.toggle")),
    "invalid user keybind config should not prevent command registration",
  )
  const errors = toasts.filter((toast) => toast.variant === "error")
  assert(errors.length === 2, "each invalid user keybind option should surface an error toast")
  assert(toasts.some((toast) => String(toast.message).includes("toggle_key")), "the toggle_key error toast should name the option")
  assert(toasts.some((toast) => String(toast.message).includes("normal_keybinds")), "the normal_keybinds error toast should name the option")
  assert(
    toasts.some((toast) => toast.variant === "warning" && String(toast.message).includes("normal_leader")),
    "normal_leader should surface a v2 deprecation warning",
  )
}

console.log("ok: adapter behavior checks passed")
