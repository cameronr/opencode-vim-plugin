import type { KeyEvent, Renderable, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Binding, CommandContext } from "@opentui/keymap"
import type { TextareaRenderable } from "@opentui/core"
import { createVimHandler } from "./vim/vim-handler"
import { useVimIndicator } from "./vim/vim-indicator"
import { createVimState, type VimMode } from "./vim/vim-state"

type VimContext = CommandContext<Renderable, KeyEvent>

type TextareaLike = TextareaRenderable & {
  focused?: boolean
}

const COMMAND_KEY = "ocv.vim.key"
const COMMAND_QUIT = "ocv.vim.quit"
const COMMAND_PALETTE = "command.palette.show"
const COMMAND_EXIT = "app.exit"

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

const normalKeys = [
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
  ",",
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
  "shift+,",
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

const insertPrintableKeys = [
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
  ",",
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
  "shift+,",
  "shift+.",
  "shift+slash",
  "~",
]

function unique<Value>(items: readonly Value[]) {
  return [...new Set(items)]
}

export function createPromptVim(
  api: TuiPluginApi,
  input: { enabled: () => boolean; initialMode?: VimMode; langmap?: () => Record<string, string> | undefined },
) {
  function currentPromptEditor() {
    if (api.ui.dialog.open) return
    const route = api.route.current.name
    if (route !== "home" && route !== "session") return
    const editor = api.renderer.currentFocusedEditor
    if (!isTextareaLike(editor)) return
    if (editor.focused === false) return
    return editor
  }

  function promptEditor() {
    if (!input.enabled()) return
    return currentPromptEditor()
  }

  function applyCursorStyle() {
    const editor = currentPromptEditor()
    if (!editor) return
    if (!input.enabled()) {
      editor.cursorStyle = { style: "line", blinking: true }
      return
    }
    if (state.isInsert()) {
      editor.cursorStyle = { style: "line", blinking: true }
      return
    }
    if (state.isReplace()) {
      editor.cursorStyle = { style: "underline", blinking: false }
      return
    }
    editor.cursorStyle = { style: "block", blinking: false }
  }

  function textarea() {
    const editor = promptEditor()
    if (!editor) throw new Error("No focused OpenCode prompt textarea")
    return editor
  }

  const state = createVimState({
    enabled: () => Boolean(promptEditor()),
    initial: () => input.initialMode,
  })

  const handler = createVimHandler({
    enabled: () => Boolean(promptEditor()),
    state,
    textarea,
    submit: () => textarea().submit(),
    scroll(action) {
      if (action === "line-down") api.keymap.dispatchCommand("session.line.down")
      if (action === "line-up") api.keymap.dispatchCommand("session.line.up")
      if (action === "half-down") api.keymap.dispatchCommand("session.half.page.down")
      if (action === "half-up") api.keymap.dispatchCommand("session.half.page.up")
      if (action === "page-down") api.keymap.dispatchCommand("session.page.down")
      if (action === "page-up") api.keymap.dispatchCommand("session.page.up")
    },
    jump(action) {
      if (action === "top") textarea().gotoBufferHome()
      if (action === "bottom") textarea().gotoBufferEnd()
    },
    navigate: () => {},
    autocomplete: () => false,
    langmap: input.langmap,
  })

  const indicator = useVimIndicator({
    enabled: input.enabled,
    active: () => api.route.current.name === "home" || api.route.current.name === "session",
    state,
  })

  const commands = [
    {
      name: COMMAND_QUIT,
      title: "Quit",
      category: "System",
      namespace: "palette",
      slashName: "q",
      slashAliases: ["quit"],
      run() {
        api.keymap.dispatchCommand(COMMAND_EXIT)
        api.ui.dialog.clear()
      },
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
        if (state.mode() === "normal" && event.name === ":" && !hasModifier(event)) {
          event.preventDefault()
          event.stopPropagation()
          api.keymap.dispatchCommand(COMMAND_PALETTE)
          return true
        }
        const handled = handler.handleKey(event)
        applyCursorStyle()
        if (handled) ctx.event.stopPropagation()
        return handled
      },
    },
  ]

  const bindings: Binding<Renderable, KeyEvent>[] = unique([...normalKeys, ...insertPrintableKeys]).map((key) => ({
    key,
    cmd: COMMAND_KEY,
    preventDefault: false,
  }))

  return {
    applyCursorStyle,
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
