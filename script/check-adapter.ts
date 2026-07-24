#!/usr/bin/env bun

export {}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
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

async function setup(options: unknown = { initial_mode: "normal" }) {
  const plugin = ((await import("../dist/tui.js" as string)) as any).default
  const layers: any[] = []
  const tokens: any[] = []
  const dispatched: string[] = []
  const disposers: Array<() => void | Promise<void>> = []
  const api: any = {
    app: { version: "test" },
    kv: { get: (_key: string, fallback: unknown) => fallback, set() {} },
    mode: { current: () => "base", push: () => () => {} },
    keymap: {
      registerLayer(layer: any) {
        layers.push(layer)
        return () => {}
      },
      registerToken(token: any) {
        tokens.push(token)
        return () => {}
      },
      dispatchCommand(command: string) {
        dispatched.push(command)
        return { ok: true }
      },
    },
    slots: { register() {} },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose(fn: () => void | Promise<void>) {
        disposers.push(fn)
        return () => {
          const index = disposers.indexOf(fn)
          if (index >= 0) disposers.splice(index, 1)
        }
      },
    },
    ui: { toast() {}, dialog: { open: false, clear() {} } },
    route: { current: { name: "home" } },
    renderer: { currentFocusedEditor: null, requestRender() {} },
    theme: { current: { textMuted: {}, text: {}, secondary: {}, background: { a: 1 } } },
  }
  await plugin.tui(api, options, {})
  return { api, layers, tokens, dispatched, disposers }
}

{
  const { layers, tokens, api } = await setup({
    initial_mode: "normal",
    normal_leader: "space",
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

  assert(tokens.some((token) => token.name === "ocv-plugin-leader" && token.key === "space"), "normal leader token was not registered")
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  assert(normalLayer.mode === "base", "normal keybind layer should be inactive while autocomplete is open")
  assert(normalLayer.bindings.some((binding: any) => binding.key === "<ocv-plugin-leader>s" && binding.cmd === "session.list"), "leader binding was not expanded")
  const aliases = {
    y: "session.line.up",
    u: "session.undo",
    r: "session.redo",
    m: "session.messages_last_user",
    t: "session.toggle.actions",
    n: "session.child.next",
    p: "session.child.previous",
  }
  for (const [key, command] of Object.entries(aliases)) {
    assert(
      normalLayer.bindings.some((binding: any) => binding.key === key && binding.cmd === command),
      `OCV-style command alias ${command} was not resolved`,
    )
  }
  assert(
    normalLayer.bindings.some((binding: any) => binding.key === "j" && binding.cmd === "session.line.down" && binding.preventDefault === false),
    "normal key binding was not registered",
  )
  assert(normalLayer.enabled() === false, "normal keybind layer should stay inactive without a focused prompt")
  api.renderer.currentFocusedEditor = fakeTextarea()
  assert(normalLayer.enabled() === true, "normal keybind layer should activate for a focused prompt in normal mode")
  api.ui.dialog.open = true
  assert(normalLayer.enabled() === false, "normal keybind layer should stay inactive while a dialog is open")
}

{
  const { layers, api } = await setup({
    enabled: true,
    normal_keybinds: { q: "session.list" },
  })
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  const editor: any = fakeTextarea()
  const originalInsertText = editor.insertText
  api.renderer.currentFocusedEditor = editor
  assert(normalLayer.enabled() === false, "Vim should start in insert mode by default")
  assert(editor.insertText !== originalInsertText, "initial insert mode should start the repeat recorder")
  const event = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })
  editor.insertText("abc")
  key.run({ event: event("escape") })
  key.run({ event: event("u") })
  assert(editor.plainText === "", "initial insert text should be undoable")
  key.run({ event: event(".") })
  assert(editor.plainText === "abc", "initial insert text should be repeatable")
}

{
  const { layers, api } = await setup({
    enabled: true,
    vim_initial_mode: "normal",
    normal_keybinds: { q: "session.list" },
  })
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  api.renderer.currentFocusedEditor = fakeTextarea()
  assert(normalLayer.enabled() === true, "vim_initial_mode normal should start Vim in normal mode")
}

{
  const { layers, api, dispatched, disposers } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.toggle"))
  assert(commandLayer?.mode === undefined, "vim palette commands should remain reachable while autocomplete is open")
  const bindingLayer = layers.find((layer) => layer.priority === 100 && layer.bindings?.some((binding: any) => binding.cmd === "ocv-plugin.key"))
  assert(bindingLayer?.mode === "base", "vim key bindings should be inactive while autocomplete is open")
  const toggle = commandLayer?.commands.find((command: any) => command.name === "ocv-plugin.toggle")
  assert(toggle?.slashName === "vim", "toggle command should expose /vim")
  const quit = commandLayer?.commands.find((command: any) => command.name === "ocv-plugin.quit")
  assert(quit?.title === "Quit" && quit.category === "System", "the command palette should expose the OCV-style Quit command")
  assert(quit?.slashName === undefined && quit.slashAliases === undefined, "the plugin should leave OpenCode's /q slash alias unchanged")
  assert(quit?.namespace === "palette", "the plugin Quit command should be reachable from OpenCode's command palette")

  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
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
  api.renderer.currentFocusedEditor = editor
  const normalEvent = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })
  const colonEvent = () => ({
    name: ";",
    sequence: ":",
    raw: ":",
    ctrl: false,
    meta: false,
    super: false,
    shift: true,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {},
  })

  const plainColon = colonEvent()
  const colonHandled = key.run({ event: plainColon })
  assert(colonHandled === true, "shift+; should be handled as :")
  assert(dispatched.at(-1) === "command.palette.show", "plain : should open the command palette")
  assert(plainColon.defaultPrevented === true, "shift+; should prevent default")
  const paletteDispatches = dispatched.length

  editor.plainText = "a:b"
  editor.cursorOffset = 0
  key.run({ event: normalEvent("f") })
  key.run({ event: colonEvent() })
  assert(editor.cursorOffset === 1, "f: should find the next colon")
  assert(dispatched.length === paletteDispatches, "f: should not open the command palette")

  editor.plainText = "ab:c"
  editor.cursorOffset = 0
  key.run({ event: normalEvent("t") })
  key.run({ event: colonEvent() })
  assert(editor.cursorOffset === 1, "t: should move until the next colon")

  editor.plainText = "abc"
  editor.cursorOffset = 1
  key.run({ event: normalEvent("r") })
  key.run({ event: colonEvent() })
  assert(editor.plainText === "a:c", "r: should replace the current character with a colon")

  editor.plainText = "ab:cd"
  editor.cursorOffset = 0
  key.run({ event: normalEvent("d") })
  key.run({ event: normalEvent("f") })
  key.run({ event: colonEvent() })
  assert(editor.plainText === "cd", "df: should delete through the next colon")

  editor.plainText = "word"
  editor.cursorOffset = 0
  key.run({ event: normalEvent("d") })
  key.run({ event: colonEvent() })
  key.run({ event: normalEvent("w") })
  assert(editor.plainText === "word" && editor.cursorOffset === 4, "an invalid d: should not leave a pending delete")
  assert(dispatched.length === paletteDispatches, "an operator-pending : should not open the command palette")

  editor.plainText = ""
  editor.cursorOffset = 0

  const event: any = {
    name: "/",
    sequence: "/",
    raw: "/",
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.propagationStopped = true
    },
  }
  const handled = key.run({ event })
  assert(handled === true, "empty slash should be handled")
  assert(editor.plainText === "/", "empty slash should enter insert text")
  assert(event.defaultPrevented === true, "empty slash should prevent default")
  assert(editor.render !== originalRender, "focused prompt render should be patched for block cursor drawing")
  key.run({ event: normalEvent("escape") })
  const originalInsertText = editor.insertText
  key.run({ event: normalEvent("i") })
  assert(editor.insertText !== originalInsertText, "insert mode should install the repeat recorder")
  assert(editor.cursorStyle?.style === "line", "enabled insert mode should use the Vim cursor style")
  toggle.run()
  assert(editor.showCursor === true, "disabling Vim should restore the prompt cursor visibility")
  assert(editor.cursorStyle === defaultCursorStyle, "disabling Vim should restore the prompt cursor style")
  assert(editor.selectionBg === defaultSelectionBg, "disabling Vim should restore the prompt selection background")
  assert(editor.selectionFg === defaultSelectionFg, "disabling Vim should restore the prompt selection foreground")
  assert(disposers.length === 1, "prompt cleanup should be registered with plugin lifecycle")
  await disposers[0]?.()
  assert(editor.render === originalRender, "prompt cleanup should restore patched render")
  assert(editor.clear === originalClear, "prompt cleanup should restore patched clear")
  assert(editor.submit === originalSubmit, "prompt patching should leave submit unchanged")
  assert(editor.onPaste === originalPaste, "prompt cleanup should restore patched paste")
  assert(editor.insertText === originalInsertText, "prompt cleanup should restore repeat recorder methods")
}

{
  const { layers, api } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const toggle = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.toggle")
  const editor = fakeTextarea()
  editor.plainText = "a\nb"
  api.renderer.currentFocusedEditor = editor
  const event = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })

  key.run({ event: event("d") })
  key.run({ event: event("g") })
  toggle.run()
  toggle.run()
  key.run({ event: event("g") })
  key.run({ event: event("j") })
  assert(editor.plainText === "a\nb", "toggling Vim should clear handler-private pending operator state")
}

{
  const { layers, api, dispatched } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  api.renderer.currentFocusedEditor = fakeTextarea()

  const shiftG: any = {
    name: "g",
    sequence: "G",
    raw: "G",
    ctrl: false,
    meta: false,
    super: false,
    shift: true,
    preventDefault() {},
    stopPropagation() {},
  }
  key.run({ event: shiftG })
  assert(dispatched.at(-1) === "session.last", "G on an empty prompt should jump to the last session message")

  const g = () => ({
    name: "g",
    sequence: "g",
    raw: "g",
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })
  key.run({ event: g() })
  key.run({ event: g() })
  assert(dispatched.at(-1) === "session.first", "gg on an empty prompt should jump to the first session message")
}

{
  const { layers, api } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const editor: any = fakeTextarea()
  editor.height = 5
  editor.visualCursor.visualRow = 2
  editor.cursorOffset = 2
  api.renderer.currentFocusedEditor = editor

  const shifted = (name: string, sequence: string) => ({
    name,
    sequence,
    raw: sequence,
    ctrl: false,
    meta: false,
    super: false,
    shift: true,
    preventDefault() {},
    stopPropagation() {},
  })

  key.run({ event: shifted("h", "H") })
  assert(editor.visualCursor.visualRow === 0, "H should jump to the top prompt viewport row")
  key.run({ event: shifted("l", "L") })
  assert(editor.visualCursor.visualRow === 4, "L should jump to the bottom prompt viewport row")
  key.run({ event: shifted("m", "M") })
  assert(editor.visualCursor.visualRow === 2, "M should jump to the middle prompt viewport row")
}

{
  const { layers, api } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const editor: any = fakeTextarea()
  editor.plainText = "draft"
  editor.submit = () => {
    editor.clear()
    return true
  }
  api.renderer.currentFocusedEditor = editor
  const event = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })

  key.run({ event: event("x") })
  key.run({ event: event("return") })
  key.run({ event: event("u") })
  assert(editor.plainText === "", "submitting should clear Vim undo history from the previous prompt")
}

{
  const { layers, api } = await setup({ initial_mode: "normal", insert_after_submit: true })
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const editor: any = fakeTextarea()
  const originalInsertText = editor.insertText
  api.renderer.currentFocusedEditor = editor
  const event = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })

  key.run({ event: event("i") })
  editor.insertText("draft")
  editor.clear()
  assert(editor.insertText !== originalInsertText, "insert_after_submit should restart the repeat recorder")
  editor.insertText("abc")
  key.run({ event: event("escape") })
  key.run({ event: event("u") })
  assert(editor.plainText === "", "insert_after_submit text should be undoable without restoring prior prompt history")
  key.run({ event: event(".") })
  assert(editor.plainText === "abc", "insert_after_submit text should be repeatable")
}

{
  const { layers, api } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const editor: any = fakeTextarea()
  editor.plainText = "draft"
  editor.submit = () => true
  const originalInsertText = editor.insertText
  api.renderer.currentFocusedEditor = editor
  const event = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })

  key.run({ event: event("x") })
  editor.submit()
  key.run({ event: event("u") })
  assert(editor.plainText === "draft", "a rejected submission should preserve Vim undo history")

  key.run({ event: event("i") })
  editor.insertText("!")
  editor.submit()
  assert(editor.insertText !== originalInsertText, "a rejected submission should keep the repeat recorder active")
}

{
  const { layers, api } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const editor: any = fakeTextarea()
  const stats: { nativePastes: number } = { nativePastes: 0 }
  editor.onPaste = () => stats.nativePastes++
  api.renderer.currentFocusedEditor = editor
  const keyEvent = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })
  let prevented = false
  const pasteEvent = {
    preventDefault() {
      prevented = true
    },
    stopPropagation() {},
  }

  key.run({ event: keyEvent("h") })
  editor.onPaste(pasteEvent)
  assert(prevented && stats.nativePastes === 0, "bracketed paste should be blocked in normal mode")
  key.run({ event: keyEvent("i") })
  editor.onPaste(pasteEvent)
  assert(Boolean(stats.nativePastes), "bracketed paste should reach the editor in insert mode")
}

{
  const { layers, api } = await setup({ initial_mode: "normal", vim_langmap: { р: "h" } })
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const bindingLayer = layers.find((layer) => layer.priority === 100)
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const editor: any = fakeTextarea()
  editor.plainText = "word"
  editor.cursorOffset = 2
  api.renderer.currentFocusedEditor = editor

  assert(
    bindingLayer.bindings.some((binding: any) => binding.key === "р" && binding.cmd === "ocv-plugin.key"),
    "non-ASCII langmap keys should be registered with the keymap",
  )
  key.run({
    event: {
      name: "р",
      sequence: "р",
      raw: "р",
      ctrl: false,
      meta: false,
      super: false,
      shift: false,
      preventDefault() {},
      stopPropagation() {},
    },
  })
  assert(editor.cursorOffset === 1, "non-ASCII langmap keys should reach the Vim handler")
}

{
  const { layers, api } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const first: any = fakeTextarea()
  first.plainText = "old"
  const second: any = fakeTextarea()
  second.plainText = "new"
  const event = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })

  api.renderer.currentFocusedEditor = first
  key.run({ event: event("x") })
  api.renderer.currentFocusedEditor = second
  key.run({ event: event("u") })
  assert(second.plainText === "new", "switching prompt editors should isolate Vim undo history")
}

{
  const { layers, api, disposers } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const first: any = fakeTextarea()
  const firstRender = first.render
  const second: any = fakeTextarea()
  const secondRender = second.render
  const event = (name: string) => ({
    name,
    sequence: name,
    raw: name,
    ctrl: false,
    meta: false,
    super: false,
    shift: false,
    preventDefault() {},
    stopPropagation() {},
  })

  api.renderer.currentFocusedEditor = first
  key.run({ event: event("x") })
  assert(first.render !== firstRender, "first prompt editor should be patched")
  first.isDestroyed = true
  api.renderer.currentFocusedEditor = second
  key.run({ event: event("x") })
  assert(second.render !== secondRender, "second prompt editor should be patched")
  await disposers[0]?.()
  assert(first.render !== firstRender, "destroyed prompt editors should be pruned before cleanup")
  assert(second.render === secondRender, "live prompt editors should still be restored on cleanup")
}

{
  const { layers, api } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.key"))
  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const event = (name: string, shift = false, sequence = name) => ({
    name,
    sequence,
    raw: sequence,
    ctrl: false,
    meta: false,
    super: false,
    shift,
    preventDefault() {},
    stopPropagation() {},
  })

  const visualFirst: any = fakeTextarea()
  visualFirst.plainText = "old"
  const visualSecond: any = fakeTextarea()
  visualSecond.plainText = "new"
  visualSecond.cursorOffset = 1
  api.renderer.currentFocusedEditor = visualFirst
  key.run({ event: event("v") })
  key.run({ event: event("l") })
  assert(visualFirst.editorView.getSelection(), "visual mode should select text in the first editor")
  api.renderer.currentFocusedEditor = visualSecond
  key.run({ event: event("x") })
  assert(!visualFirst.editorView.getSelection(), "switching editors should clear the previous visual selection")
  assert(visualSecond.plainText === "nw", "switching editors should leave visual mode before handling the next key")

  const replaceFirst: any = fakeTextarea()
  replaceFirst.plainText = "old"
  const replaceSecond: any = fakeTextarea()
  replaceSecond.plainText = "new"
  replaceSecond.cursorOffset = 1
  api.renderer.currentFocusedEditor = replaceFirst
  key.run({ event: event("r", true, "R") })
  key.run({ event: event("x") })
  api.renderer.currentFocusedEditor = replaceSecond
  key.run({ event: event("z") })
  assert(replaceSecond.plainText === "new", "switching editors should leave replace mode before handling the next key")
}

{
  const plugin = ((await import("../dist/tui.js" as string)) as any).default
  const layers: any[] = []
  const toasts: any[] = []
  const api: any = {
    app: { version: "test" },
    kv: { get: (_key: string, fallback: unknown) => fallback, set() {} },
    mode: { current: () => "base", push: () => () => {} },
    keymap: {
      registerLayer(layer: any) {
        if (layer.bindings?.some((binding: any) => binding.cmd === "ocv-plugin.toggle")) {
          throw new Error('Invalid key "ctrl+": missing key name')
        }
        if (layer.priority === 200) throw new Error('Invalid key "<broken": unterminated token')
        layers.push(layer)
        return () => {}
      },
      registerToken() {
        throw new Error('Invalid key "": sequence cannot be empty')
      },
      dispatchCommand() {
        return { ok: true }
      },
    },
    slots: { register() {} },
    lifecycle: { signal: new AbortController().signal, onDispose: () => () => {} },
    ui: { toast: (toast: any) => toasts.push(toast), dialog: { open: false, clear() {} } },
    route: { current: { name: "home" } },
    renderer: { currentFocusedEditor: null, requestRender() {} },
    theme: { current: { textMuted: {}, text: {}, secondary: {}, background: { a: 1 } } },
  }
  await plugin.tui(api, { toggle_key: "ctrl+", normal_leader: "space", normal_keybinds: { "<broken": "session.list" } }, {})
  assert(
    layers.some((layer) => layer.bindings?.some((binding: any) => binding.cmd === "ocv-plugin.key")),
    "invalid user keybind config should not prevent core vim bindings from registering",
  )
  assert(
    layers.some((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.toggle")),
    "invalid user keybind config should not prevent command registration",
  )
  assert(toasts.filter((toast) => toast.variant === "error").length === 3, "each invalid user keybind option should surface an error toast")
  assert(
    toasts.some((toast) => String(toast.message).includes("toggle_key")),
    "the toggle_key error toast should name the option",
  )
}

console.log("ok: adapter behavior checks passed")
