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
    editBuffer: {},
    editorView: {
      getSelection: () => null,
      setSelection() {},
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
    insertText(text: string) {
      this.plainText = this.plainText.slice(0, this.cursorOffset) + text + this.plainText.slice(this.cursorOffset)
      this.cursorOffset += text.length
    },
    deleteRange() {},
    setText(text: string) {
      this.plainText = text
      this.cursorOffset = text.length
    },
    submit() {},
    gotoBufferHome() {
      this.cursorOffset = 0
    },
    gotoBufferEnd() {
      this.cursorOffset = this.plainText.length
    },
    render() {},
    getLayoutNode() {
      return { markDirty() {} }
    },
    requestRender() {},
  }
}

async function setup(options: unknown = {}) {
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
    normal_leader: "space",
    normal_keybinds: {
      "<leader>s": "session.list",
      j: { command: "session.line.down", desc: "Scroll down", preventDefault: false },
    },
  })

  assert(tokens.some((token) => token.name === "ocv-plugin-leader" && token.key === "space"), "normal leader token was not registered")
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  assert(normalLayer.mode === "base", "normal keybind layer should be inactive while autocomplete is open")
  assert(normalLayer.bindings.some((binding: any) => binding.key === "<ocv-plugin-leader>s" && binding.cmd === "session.list"), "leader binding was not expanded")
  assert(
    normalLayer.bindings.some((binding: any) => binding.key === "j" && binding.cmd === "session.line.down" && binding.preventDefault === false),
    "normal key binding was not registered",
  )
  assert(normalLayer.enabled() === true, "normal keybind layer should be active in normal mode even before prompt focus settles")
  api.renderer.currentFocusedEditor = fakeTextarea()
  assert(normalLayer.enabled() === true, "normal keybind layer should stay active for a focused prompt in normal mode")
}

{
  const { layers, api, disposers } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.name === "ocv-plugin.quit"))
  assert(commandLayer?.mode === undefined, "vim palette commands should remain reachable while autocomplete is open")
  const bindingLayer = layers.find((layer) => layer.priority === 100 && layer.bindings?.some((binding: any) => binding.cmd === "ocv-plugin.key"))
  assert(bindingLayer?.mode === "base", "vim key bindings should be inactive while autocomplete is open")
  const toggle = commandLayer?.commands.find((command: any) => command.name === "ocv-plugin.toggle")
  assert(toggle?.slashName === "vim", "toggle command should expose /vim")
  const quit = commandLayer?.commands.find((command: any) => command.name === "ocv-plugin.quit")
  assert(quit?.title === "Quit", "quit command title should be concise")
  assert(quit?.category === "System", "quit command should be in the System category")

  const key = commandLayer.commands.find((command: any) => command.name === "ocv-plugin.key")
  const editor = fakeTextarea()
  api.renderer.currentFocusedEditor = editor
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
  const originalRender = editor.render
  const handled = key.run({ event })
  assert(handled === true, "empty slash should be handled")
  assert(editor.plainText === "/", "empty slash should enter insert text")
  assert(event.defaultPrevented === true, "empty slash should prevent default")
  assert(editor.render !== originalRender, "focused prompt render should be patched for block cursor drawing")
  assert(disposers.length === 1, "prompt cleanup should be registered with plugin lifecycle")
  await disposers[0]?.()
  assert(editor.render === originalRender, "prompt cleanup should restore patched render")
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

console.log("ok: adapter behavior checks passed")
