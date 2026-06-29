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
  "[",
  "]",
  "shift+[",
  "shift+]",
  "shift+,",
  "shift+.",
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
  "\"",
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
    scroll: () => {},
    jump(action) {
      if (action === "top") textarea().gotoBufferHome()
      if (action === "bottom") textarea().gotoBufferEnd()
    },
    navigate: () => {},
    langmap: input.langmap,
  })

  const indicator = useVimIndicator({
    enabled: input.enabled,
    active: () => api.route.current.name === "home" || api.route.current.name === "session",
    state,
  })

  const commands = [
    {
      name: COMMAND_KEY,
      title: "Vim key",
      desc: "Handle Vim prompt key",
      category: "Vim",
      hidden: true,
      run(ctx: VimContext) {
        if (!promptEditor()) return false
        const handled = handler.handleKey(ctx.event)
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
