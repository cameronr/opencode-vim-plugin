import { spawnSync } from "node:child_process"
import type { KeyEvent, Renderable, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Binding, CommandContext, KeyLike } from "@opentui/keymap"
import { RGBA, type TextareaRenderable } from "@opentui/core"
import { createVimHandler } from "./vim/handler"
import { useVimIndicator } from "./vim/indicator"
import { createVimState, type VimMode, type VimRegister } from "./vim/state"

type VimContext = CommandContext<Renderable, KeyEvent>

const PROMPT_RENDER_PATCH = Symbol("ocv-plugin.prompt.render.patch")

type PromptRenderPatch = {
  original: TextareaLike["render"]
  patched: TextareaLike["render"]
  originalClear: TextareaLike["clear"]
  patchedClear: TextareaLike["clear"]
  originalPaste: TextareaLike["onPaste"]
  patchedPaste: NonNullable<TextareaLike["onPaste"]>
  originalShowCursor: TextareaLike["showCursor"]
  originalCursorStyle: TextareaLike["cursorStyle"]
  originalSelectionBg: TextareaLike["selectionBg"]
  originalSelectionFg: TextareaLike["selectionFg"]
}

type TextareaLike = TextareaRenderable & {
  focused?: boolean
  [PROMPT_RENDER_PATCH]?: PromptRenderPatch
}

const COMMAND_KEY = "ocv-plugin.key"
const COMMAND_QUIT = "vim.q"
const COMMAND_PALETTE = "command.palette.show"
const COMMAND_EXIT = "app.exit"
const YANK_FLASH_MS = 70
// Clipboard tools answer in single-digit milliseconds when they work; a short
// timeout only caps the stall when they don't (spawnSync blocks the render loop).
const CLIPBOARD_TIMEOUT_MS = 300

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isTextareaLike(value: unknown): value is TextareaLike {
  if (!isRecord(value)) return false
  return (
    typeof value.plainText === "string" &&
    typeof value.cursorOffset === "number" &&
    typeof value.insertText === "function" &&
    typeof value.deleteRange === "function" &&
    typeof value.setText === "function" &&
    typeof value.editBuffer === "object"
  )
}

const shiftedSymbols: Record<string, string> = {
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "(",
  "0": ")",
  "-": "_",
  "=": "+",
  "[": "{",
  "]": "}",
  "\\": "|",
  ";": ":",
  "'": '"',
  ",": "<",
  ".": ">",
  "/": "?",
  "`": "~",
}

function vimEvent(event: KeyEvent) {
  const symbol = event.shift ? shiftedSymbols[event.name] : undefined
  if (!symbol) return event
  return {
    ...event,
    name: symbol,
    sequence: symbol,
    raw: symbol,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
  }
}

function hasModifier(event: { ctrl?: boolean; meta?: boolean; super?: boolean }) {
  return !!event.ctrl || !!event.meta || !!event.super
}

function selectedForeground(api: TuiPluginApi, bg: RGBA) {
  if (api.theme.current.background.a > 0) return api.theme.current.background
  return 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}

function clipboardRead() {
  const command =
    process.platform === "darwin"
      ? ["pbpaste"]
      : process.platform === "win32"
        ? ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"]
        : ["sh", "-c", "wl-paste -n 2>/dev/null || xclip -selection clipboard -out 2>/dev/null || xsel --clipboard --output 2>/dev/null"]
  const result = spawnSync(command[0]!, command.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: CLIPBOARD_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.status !== 0 || result.error) return
  return result.stdout
}

function clipboardWrite(text: string): "ok" | "missing" | "failed" {
  const command =
    process.platform === "darwin"
      ? ["pbcopy"]
      : process.platform === "win32"
        ? ["powershell.exe", "-NoProfile", "-Command", "[Console]::In.ReadToEnd() | Set-Clipboard"]
        : ["sh", "-c", "wl-copy 2>/dev/null || xclip -selection clipboard -in 2>/dev/null || xsel --clipboard --input 2>/dev/null"]
  const result = spawnSync(command[0]!, command.slice(1), {
    input: text,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
    timeout: CLIPBOARD_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error) return (result.error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "failed"
  return result.status === 0 ? "ok" : "failed"
}

// OpenCode expands commas in string bindings as separators, so literal comma keys must use object form.
const commaKey = { name: "," } as const satisfies KeyLike
const shiftedCommaKey = { name: ",", shift: true } as const satisfies KeyLike

const normalKeys: KeyLike[] = [
  "escape",
  "return",
  "space",
  "backspace",
  "delete",
  "left",
  "right",
  "up",
  "down",
  "h",
  "j",
  "k",
  "l",
  "shift+h",
  "shift+m",
  "shift+l",
  "w",
  "b",
  "e",
  "shift+w",
  "shift+b",
  "shift+e",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "shift+4",
  "shift+6",
  "shift+-",
  "$",
  "^",
  "_",
  "g",
  "shift+g",
  "f",
  "shift+f",
  "t",
  "shift+t",
  ";",
  commaKey,
  "i",
  "shift+i",
  "a",
  "shift+a",
  "o",
  "shift+o",
  "r",
  "shift+r",
  "x",
  "shift+x",
  "s",
  "shift+s",
  "c",
  "shift+c",
  "d",
  "y",
  "p",
  "shift+p",
  "u",
  "ctrl+r",
  ".",
  "v",
  "shift+v",
  "shift+j",
  "z",
  "slash",
  "shift+slash",
  "shift+;",
  "shift+'",
  "shift+`",
  ":",
  "\"",
  "'",
  "`",
  "shift+9",
  "shift+0",
  "(",
  ")",
  "[",
  "]",
  "shift+[",
  "shift+]",
  shiftedCommaKey,
  "shift+.",
  "%",
  "<",
  ">",
  "shift+5",
  "ctrl+e",
  "ctrl+y",
  "ctrl+d",
  "ctrl+u",
  "ctrl+f",
  "ctrl+b",
  "ctrl+w",
  "ctrl+v",
]

const insertPrintableKeys: KeyLike[] = [
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."0123456789".split(""),
  "space",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  commaKey,
  ".",
  "slash",
  "`",
  "shift+a",
  "shift+b",
  "shift+c",
  "shift+d",
  "shift+e",
  "shift+f",
  "shift+g",
  "shift+h",
  "shift+i",
  "shift+j",
  "shift+k",
  "shift+l",
  "shift+m",
  "shift+n",
  "shift+o",
  "shift+p",
  "shift+q",
  "shift+r",
  "shift+s",
  "shift+t",
  "shift+u",
  "shift+v",
  "shift+w",
  "shift+x",
  "shift+y",
  "shift+z",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "shift+1",
  "shift+2",
  "shift+3",
  "shift+4",
  "shift+5",
  "shift+6",
  "shift+7",
  "shift+8",
  "shift+9",
  "shift+0",
  "shift+-",
  "shift+=",
  "shift+[",
  "shift+]",
  "shift+\\",
  "{",
  "}",
  "|",
  ":",
  "\"",
  "<",
  ">",
  "?",
  shiftedCommaKey,
  "shift+.",
  "shift+slash",
  "shift+;",
  "shift+'",
  "shift+`",
  "~",
]

function unique<Value>(items: readonly Value[]) {
  return [...new Set(items)]
}

export function createPromptVim(
  api: TuiPluginApi,
  input: {
    enabled: () => boolean
    initialMode?: VimMode
    enterSubmit?: boolean
    insertAfterSubmit?: boolean
    systemClipboardRegister?: boolean
    langmap?: () => Record<string, string> | undefined
  },
) {
  let lastPromptEditor: TextareaLike | undefined
  let onPromptEditorChange = (_previous: TextareaLike | undefined) => {}
  let onPromptClear = () => {}

  function currentPromptEditor() {
    if (api.ui.dialog.open) return
    const route = api.route.current.name
    if (route !== "home" && route !== "session") return
    const editor = api.renderer.currentFocusedEditor
    if (!isTextareaLike(editor)) return
    if (editor.focused === false) return
    if (editor !== lastPromptEditor) {
      const previous = lastPromptEditor
      lastPromptEditor = editor
      onPromptEditorChange(previous)
    }
    return editor
  }

  function promptEditor() {
    if (!input.enabled()) return
    return currentPromptEditor()
  }

  const patchedEditors = new Set<TextareaLike>()

  function prunePatchedEditors() {
    for (const patched of patchedEditors) {
      if (patched.isDestroyed) patchedEditors.delete(patched)
    }
  }

  function restorePromptAppearance(editor: TextareaLike, patch: PromptRenderPatch) {
    editor.showCursor = patch.originalShowCursor
    editor.cursorStyle = patch.originalCursorStyle
    editor.selectionBg = patch.originalSelectionBg
    editor.selectionFg = patch.originalSelectionFg
    editor.getLayoutNode().markDirty()
    editor.requestRender()
  }

  function patchPromptEditor(editor: TextareaLike) {
    if (editor[PROMPT_RENDER_PATCH]) return
    prunePatchedEditors()
    const original = editor.render
    const patched: TextareaLike["render"] = (buffer, deltaTime) => {
      original.call(editor, buffer, deltaTime)
      if (!input.enabled()) return
      if (!(state.mode() === "normal" || state.isVisual())) return
      if (!editor.focused) return
      const cursor = editor.visualCursor
      if (cursor.visualRow < 0 || cursor.visualRow >= editor.height) return
      if (cursor.visualCol < 0 || cursor.visualCol >= editor.width) return
      const row = editor.y + cursor.visualRow
      const col = editor.x + cursor.visualCol
      if (row < 0 || row >= buffer.height) return
      if (col < 0 || col >= buffer.width) return
      const offset = (row * buffer.width + col) * 4
      buffer.buffers.fg.set(selectedForeground(api, api.theme.current.text).buffer.subarray(0, 4), offset)
      buffer.buffers.bg.set(api.theme.current.text.buffer.subarray(0, 4), offset)
    }
    const originalClear = editor.clear
    const patchedClear: TextareaLike["clear"] = (...args) => {
      originalClear.apply(editor, args)
      onPromptClear()
    }
    const originalPaste = editor.onPaste
    const patchedPaste: NonNullable<TextareaLike["onPaste"]> = (event) => {
      if (input.enabled() && state.mode() !== "insert" && state.mode() !== "replace") {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      return originalPaste?.call(editor, event)
    }
    editor[PROMPT_RENDER_PATCH] = {
      original,
      patched,
      originalClear,
      patchedClear,
      originalPaste,
      patchedPaste,
      originalShowCursor: editor.showCursor,
      originalCursorStyle: editor.cursorStyle,
      originalSelectionBg: editor.selectionBg,
      originalSelectionFg: editor.selectionFg,
    }
    editor.render = patched
    editor.clear = patchedClear
    editor.onPaste = patchedPaste
    patchedEditors.add(editor)
  }

  function applyCursorStyle() {
    const editor = currentPromptEditor()
    if (!editor) return
    patchPromptEditor(editor)
    const patch = editor[PROMPT_RENDER_PATCH]!
    if (!input.enabled()) {
      restorePromptAppearance(editor, patch)
      return
    }
    const visual = state.isVisual()
    editor.selectionBg = visual ? api.theme.current.secondary : undefined
    editor.selectionFg = visual ? selectedForeground(api, api.theme.current.secondary) : undefined
    if (state.isInsert()) {
      editor.showCursor = true
      editor.cursorStyle = { style: "line", blinking: true }
      return
    }
    if (state.isReplace()) {
      editor.showCursor = true
      editor.cursorStyle = { style: "underline", blinking: false }
      return
    }
    editor.cursorStyle = { style: "block", blinking: false }
    editor.showCursor = false
    editor.requestRender()
  }

  function textarea() {
    const editor = promptEditor()
    if (!editor) throw new Error("No focused OpenCode prompt textarea")
    return editor
  }

  const state = createVimState({
    enabled: input.enabled,
    initial: () => input.initialMode,
  })
  let clipboardRegister: VimRegister = null
  let clipboardText: string | undefined
  let clipboardUnavailable = false
  let clipboardFailures = 0

  // Fail fast: stop shelling out once the clipboard tool is known to be dead so
  // every yank/delete/paste doesn't block on it (spawnSync stalls the render
  // loop). A missing binary latches immediately; ambiguous failures (timeout,
  // nonzero exit) only latch after a few in a row, so a slow-but-working tool
  // (PowerShell cold start, X11 over SSH) isn't disabled by one hiccup.
  // Reads are not latched because an empty Wayland clipboard also exits non-zero.
  const CLIPBOARD_MAX_FAILURES = 3

  function clipboardFailed(kind: "missing" | "failed") {
    clipboardFailures = kind === "missing" ? CLIPBOARD_MAX_FAILURES : clipboardFailures + 1
    if (clipboardFailures < CLIPBOARD_MAX_FAILURES || clipboardUnavailable) return
    clipboardUnavailable = true
    api.ui.toast({ variant: "warning", message: "System clipboard unavailable, using the internal Vim register" })
  }
  let flash = 0
  let flashSpan: { start: number; end: number } | undefined
  let flashTimer: ReturnType<typeof setTimeout> | undefined

  function register() {
    if (!input.systemClipboardRegister || clipboardUnavailable) return state.register()
    const text = clipboardRead()
    if (text === undefined) return clipboardRegister ?? state.register()
    if (clipboardRegister && text === clipboardText) return clipboardRegister
    return { text, linewise: false }
  }

  function setRegister(next: VimRegister, notify = false) {
    state.setRegister(next)
    if (!input.systemClipboardRegister || !next || clipboardUnavailable) return
    clipboardRegister = next
    clipboardText = next.text
    const copied = clipboardWrite(next.text)
    if (copied !== "ok") {
      clipboardFailed(copied)
      return
    }
    clipboardFailures = 0
    if (notify) api.ui.toast({ message: "Copied to clipboard", variant: "info" })
  }

  function submitPrompt() {
    const editor = textarea()
    patchPromptEditor(editor)
    editor.submit()
  }

  function flashYank(span: { start: number; end: number }) {
    const editor = promptEditor()
    if (!editor || span.end <= span.start) return
    flash++
    flashSpan = span
    const id = flash
    const cursor = editor.cursorOffset
    editor.editorView.setSelection(span.start, span.end, editor.selectionBg, editor.selectionFg)
    editor.cursorOffset = cursor
    editor.getLayoutNode().markDirty()
    api.renderer.requestRender()
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      if (editor.isDestroyed) return
      if (id !== flash) return
      if (state.isVisual()) {
        flashSpan = undefined
        return
      }
      const selection = editor.editorView.getSelection()
      if (!selection) {
        flashSpan = undefined
        return
      }
      if (selection.start !== span.start || selection.end !== span.end) {
        flashSpan = undefined
        return
      }
      flashSpan = undefined
      editor.clearSelection()
      editor.getLayoutNode().markDirty()
      api.renderer.requestRender()
    }, YANK_FLASH_MS)
  }

  function jumpPromptViewport(action: "high" | "middle" | "low") {
    const editor = textarea()
    const row = action === "high" ? 0 : action === "middle" ? Math.max(0, Math.floor((editor.height - 1) / 2)) : editor.height - 1

    let prev = -1
    while (editor.visualCursor.visualRow > row && editor.cursorOffset !== prev) {
      prev = editor.cursorOffset
      editor.moveCursorUp()
    }

    prev = -1
    while (editor.visualCursor.visualRow < row && editor.cursorOffset !== prev) {
      prev = editor.cursorOffset
      editor.moveCursorDown()
    }
  }

  const handler = createVimHandler({
    enabled: () => Boolean(promptEditor()),
    state,
    textarea,
    register,
    setRegister,
    pasteOverSelection() {
      const selection = textarea().editorView.getSelection()
      if (!selection) return false
      return !flashSpan || selection.start !== flashSpan.start || selection.end !== flashSpan.end
    },
    submit: submitPrompt,
    commandPalette() {
      api.keymap.dispatchCommand(COMMAND_PALETTE)
    },
    flash: flashYank,
    scroll(action) {
      if (action === "line-down") api.keymap.dispatchCommand("session.line.down")
      if (action === "line-up") api.keymap.dispatchCommand("session.line.up")
      if (action === "half-down") api.keymap.dispatchCommand("session.half.page.down")
      if (action === "half-up") api.keymap.dispatchCommand("session.half.page.up")
      if (action === "page-down") api.keymap.dispatchCommand("session.page.down")
      if (action === "page-up") api.keymap.dispatchCommand("session.page.up")
    },
    jump(action) {
      if (action === "high" || action === "middle" || action === "low") {
        jumpPromptViewport(action)
        return
      }
      const editor = textarea()
      if (editor.plainText.length > 0) {
        if (action === "top") editor.gotoBufferHome()
        if (action === "bottom") editor.gotoBufferEnd()
        return
      }
      if (action === "top") api.keymap.dispatchCommand("session.first")
      if (action === "bottom") api.keymap.dispatchCommand("session.last")
    },
    // Returning false makes "/" and "?" fall through to autocomplete/insert
    // instead of the copy-mode search path (see handler.ts dispatch).
    copySearchStart: () => false,
    autocomplete: () => false,
    langmap: input.langmap,
  })

  onPromptEditorChange = (previous) => {
    const mode = state.mode()
    if (previous && (mode === "visual" || mode === "visual-line") && !previous.isDestroyed) previous.clearSelection()
    handler.cancelPending()
    state.resetHistory()
    if (mode === "visual" || mode === "visual-line" || mode === "replace") state.setMode("normal")
  }
  onPromptClear = () => {
    handler.cancelPending()
    state.resetHistory()
    state.setMode(input.insertAfterSubmit ? "insert" : "normal")
  }

  const indicator = useVimIndicator({
    enabled: input.enabled,
    active: () => api.route.current.name === "home" || api.route.current.name === "session",
    state,
  })

  const commands = [
    {
      name: COMMAND_QUIT,
      title: "Quit",
      slashName: "q",
      run: () => api.keymap.dispatchCommand(COMMAND_EXIT),
      category: "System",
    },
    {
      name: COMMAND_KEY,
      title: "Vim key",
      desc: "Handle Vim prompt key",
      category: "Vim",
      hidden: true,
      run(ctx: VimContext) {
        if (!promptEditor()) return false
        const event = vimEvent(ctx.event)
        if ((state.isInsert() || state.isReplace()) && event.name === "return" && !hasModifier(event)) {
          event.preventDefault()
          event.stopPropagation()
          if (input.enterSubmit) submitPrompt()
          else {
            if (state.isReplace()) handler.recordInsertText("\n")
            textarea().insertText("\n")
          }
          applyCursorStyle()
          return true
        }
        const handled = handler.handleKey(event)
        applyCursorStyle()
        if (handled) ctx.event.stopPropagation()
        return handled
      },
    },
  ]

  const bindings: Binding<Renderable, KeyEvent>[] = unique([
    ...normalKeys,
    ...insertPrintableKeys,
    ...Object.keys(input.langmap?.() ?? {}),
  ]).map((key) => ({
    key,
    cmd: COMMAND_KEY,
    preventDefault: false,
  }))

  function dispose() {
    handler.cancelPending()
    state.cancelEdit()
    if (flashTimer) {
      clearTimeout(flashTimer)
      flashTimer = undefined
    }
    flash++
    for (const editor of patchedEditors) {
      const patch = editor[PROMPT_RENDER_PATCH]
      if (!patch) continue
      if (editor.render === patch.patched) editor.render = patch.original
      if (editor.clear === patch.patchedClear) editor.clear = patch.originalClear
      if (editor.onPaste === patch.patchedPaste) editor.onPaste = patch.originalPaste
      delete editor[PROMPT_RENDER_PATCH]
      if (!editor.isDestroyed) {
        if (flashSpan) {
          const selection = editor.editorView.getSelection()
          if (selection?.start === flashSpan.start && selection.end === flashSpan.end) editor.clearSelection()
        }
        restorePromptAppearance(editor, patch)
      }
    }
    patchedEditors.clear()
    flashSpan = undefined
    api.renderer.requestRender()
  }

  return {
    dispose,
    cancelPending: handler.cancelPending,
    applyCursorStyle,
    active: () => Boolean(promptEditor()),
    indicator,
    pending: state.pending,
    isVisual: state.isVisual,
    isVisualLine: state.isVisualLine,
    mode: state.mode,
    setMode: state.setMode,
    commands,
    bindings,
  }
}
