import { spawnSync } from "node:child_process"
import type { Context, KeymapCommand } from "@opencode-ai/plugin/tui/context"
import { RGBA, type TextareaRenderable } from "@opentui/core"
import { createVimHandler, type VimEvent } from "./vim/handler"
import { useVimIndicator } from "./vim/indicator"
import { createVimState, type VimMode, type VimRegister } from "./vim/state"

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

const COMMAND_PALETTE = "command.palette.show"
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

// The keymap engine never passes a KeyEvent to plugin command run functions
// (empirically: run is called with no arguments), so each command rebuilds the
// vim event from the bind string it was registered with. The engine only
// dispatches when the pressed key matches the bind, so this is lossless.
function synthesizeVimEvent(bind: string): VimEvent {
  const parts = bind.split("+")
  const name = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  const shift = mods.includes("shift")
  let typed = name
  if (name.length === 1 && shift) {
    typed = shiftedSymbols[name] ?? (/[a-z]/.test(name) ? name.toUpperCase() : name)
  }
  const event: VimEvent = {
    name,
    sequence: typed,
    raw: typed,
    preventDefault: () => {},
  }
  if (shift) event.shift = true
  if (mods.includes("ctrl") || mods.includes("control")) event.ctrl = true
  if (mods.includes("meta")) event.meta = true
  if (mods.includes("super")) event.super = true
  return event
}

function hasModifier(event: { ctrl?: boolean; meta?: boolean; super?: boolean }) {
  return !!event.ctrl || !!event.meta || !!event.super
}

function selectedForeground(context: Context, bg: RGBA) {
  if (context.theme.background.default.a > 0) return context.theme.background.default
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

// OpenCode v2 splits bind strings on commas, so a literal comma key cannot be
// bound. Insert-mode commas fall through to the editor's own handler; the
// normal-mode repeat-find on "," is lost (documented v2 limitation).
const normalKeys: string[] = [
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
  "q",
  "u",
  "ctrl+r",
  ".",
  "v",
  "shift+v",
  "shift+j",
  "z",
  "/",
  "shift+/",
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

const insertPrintableKeys: string[] = [
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
  ".",
  "/",
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
  "shift+.",
  "shift+/",
  "shift+;",
  "shift+'",
  "shift+`",
  "~",
]

function unique<Value>(items: readonly Value[]) {
  return [...new Set(items)]
}

export function createPromptVim(
  context: Context,
  input: {
    enabled: () => boolean
    initialMode?: VimMode
    enterSubmit?: boolean
    insertAfterSubmit?: boolean
    systemClipboardRegister?: boolean
    langmap?: () => Record<string, string> | undefined
    vimEscapeSequence?: string
  },
) {
  let lastPromptEditor: TextareaLike | undefined
  let onPromptEditorChange = (_previous: TextareaLike | undefined) => {}
  let onPromptClear = () => {}

  function currentPromptEditor() {
    // Dialogs and menus push non-base keymap modes.
    if (context.keymap.mode.current() !== "base") return
    const route = context.ui.router.current().type
    if (route !== "home" && route !== "session") return
    const editor = context.renderer.currentFocusedEditor
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
  const pasteLayoutTimers = new Set<ReturnType<typeof setTimeout>>()

  function refreshPasteLayout(editor: TextareaLike) {
    const timer = setTimeout(() => {
      pasteLayoutTimers.delete(timer)
      if (editor.isDestroyed) return
      editor.getLayoutNode().markDirty()
      context.renderer.requestRender()
    }, 0)
    pasteLayoutTimers.add(timer)
  }

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
      buffer.buffers.fg.set(selectedForeground(context, context.theme.text.default).buffer.subarray(0, 4), offset)
      buffer.buffers.bg.set(context.theme.text.default.buffer.subarray(0, 4), offset)
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
      const result = originalPaste?.call(editor, event) as unknown
      if (typeof (result as PromiseLike<unknown> | undefined)?.then === "function") {
        void Promise.resolve(result).then(
          () => refreshPasteLayout(editor),
          () => refreshPasteLayout(editor),
        )
      } else {
        refreshPasteLayout(editor)
      }
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
    editor.selectionBg = visual ? context.theme.hue.accent[300] : undefined
    editor.selectionFg = visual ? selectedForeground(context, context.theme.hue.accent[300]) : undefined
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
    context.ui.toast.show({ variant: "warning", message: "System clipboard unavailable, using the internal Vim register" })
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
    if (notify) context.ui.toast.show({ message: "Copied to clipboard", variant: "info" })
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
    context.renderer.requestRender()
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
      context.renderer.requestRender()
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
      context.keymap.dispatch(COMMAND_PALETTE)
    },
    flash: flashYank,
    scroll(action) {
      if (action === "line-down") context.keymap.dispatch("session.line.down")
      if (action === "line-up") context.keymap.dispatch("session.line.up")
      if (action === "half-down") context.keymap.dispatch("session.half.page.down")
      if (action === "half-up") context.keymap.dispatch("session.half.page.up")
      if (action === "page-down") context.keymap.dispatch("session.page.down")
      if (action === "page-up") context.keymap.dispatch("session.page.up")
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
      if (action === "top") context.keymap.dispatch("session.first")
      if (action === "bottom") context.keymap.dispatch("session.last")
    },
    // Returning false makes "/" and "?" fall through to autocomplete/insert
    // instead of the copy-mode search path (see handler.ts dispatch).
    copySearchStart: () => false,
    autocomplete: () => false,
    langmap: input.langmap,
    vimEscapeSequence: input.vimEscapeSequence,
  })

  onPromptEditorChange = (previous) => {
    const mode = state.mode()
    if (previous && (mode === "visual" || mode === "visual-line") && !previous.isDestroyed) previous.clearSelection()
    handler.cancelPending()
    state.resetHistory()
    if (mode === "visual" || mode === "visual-line" || mode === "replace") state.setMode("normal")
    else if (input.enabled() && mode === "insert") handler.beginInsertEdit()
  }
  onPromptClear = () => {
    handler.cancelPending()
    state.resetHistory()
    state.setMode(input.insertAfterSubmit ? "insert" : "normal")
    if (input.enabled() && input.insertAfterSubmit) handler.beginInsertEdit()
  }

  const indicator = useVimIndicator({
    enabled: input.enabled,
    active: () => {
      const route = context.ui.router.current().type
      return route === "home" || route === "session"
    },
    state,
  })

  // One inline keymap command per vim key. Returning false continues dispatch
  // to the host's own bindings; returning void consumes the key.
  function runVimKey(bind: string) {
    const editor = promptEditor()
    if (!editor) return false
    const keyEvent = synthesizeVimEvent(bind)
    if ((state.isInsert() || state.isReplace()) && keyEvent.name === "return" && !hasModifier(keyEvent)) {
      if (input.enterSubmit) submitPrompt()
      else {
        if (state.isReplace()) handler.recordInsertText("\n")
        textarea().insertText("\n")
      }
      applyCursorStyle()
      return
    }
    const handled = handler.handleKey(keyEvent)
    applyCursorStyle()
    if (!handled) return false
  }

  const vimCommands: KeymapCommand[] = unique([
    ...normalKeys,
    ...insertPrintableKeys,
    ...Object.keys(input.langmap?.() ?? {}),
  ])
    // A literal comma cannot appear in a v2 bind string (comma separator).
    .filter((key) => !key.includes(","))
    .map((key) => ({
      bind: key,
      run: () => runVimKey(key),
    }))

  function dispose() {
    handler.cancelPending()
    state.cancelEdit()
    for (const timer of pasteLayoutTimers) clearTimeout(timer)
    pasteLayoutTimers.clear()
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
    context.renderer.requestRender()
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
    vimCommands,
  }
}
