import { afterEach, describe, expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { createRoot } from "solid-js"
import { createVimHandler, type VimEvent } from "./handler"
import { createVimState } from "./state"

const renderers: TestRenderer[] = []
const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  for (const renderer of renderers.splice(0)) renderer.destroy()
})

async function setup(text: string) {
  const { renderer } = await createTestRenderer({ width: 80, height: 8 })
  renderers.push(renderer)
  const textarea = new TextareaRenderable(renderer, {
    id: `replace-repeat-${renderers.length}`,
    width: 80,
    height: 6,
    initialValue: text,
  })
  renderer.root.add(textarea)

  const { state, handler } = createRoot((dispose) => {
    disposers.push(dispose)
    const state = createVimState({ enabled: () => true, initial: () => "normal" })
    // Bun resolves Solid's server build in tests, whose createMemo values are static.
    Object.assign(state, {
      isInsert: () => state.mode() === "insert",
      isReplace: () => state.mode() === "replace",
      isVisual: () => state.mode() === "visual" || state.mode() === "visual-line",
      isVisualLine: () => state.mode() === "visual-line",
      isCopy: () => state.mode() === "copy",
    })
    const handler = createVimHandler({
      enabled: () => true,
      state,
      textarea: () => textarea,
      submit() {},
      scroll() {},
      jump() {},
    })
    return { state, handler }
  })

  function press(name: string, options: Partial<VimEvent> = {}) {
    const event: VimEvent = {
      name,
      sequence: options.sequence ?? name,
      raw: options.raw ?? options.sequence ?? name,
      shift: options.shift ?? false,
      ctrl: options.ctrl ?? false,
      meta: options.meta ?? false,
      super: options.super ?? false,
      preventDefault() {},
    }
    expect(handler.handleKey(event)).toBe(true)
  }

  function insertNewline() {
    handler.recordInsertText("\n")
    textarea.insertText("\n")
  }

  return { textarea, press, insertNewline }
}

describe("replace-mode dot repeat", () => {
  test("replays inserted newlines between replaced characters", async () => {
    const { textarea, press, insertNewline } = await setup("abcd\nABCD")

    press("r", { shift: true, sequence: "R" })
    press("x")
    insertNewline()
    press("y")
    press("escape")
    press("j")
    press("0")
    press(".")

    expect(textarea.plainText).toBe("x\nycd\nx\nyCD")
  })

  test("preserves cursor placement when the replace contains only a newline", async () => {
    const { textarea, press, insertNewline } = await setup("abc\nABC")

    press("r", { shift: true, sequence: "R" })
    insertNewline()
    press("escape")
    expect(textarea.cursorOffset).toBe(1)
    press("j")
    press(".")

    expect(textarea.plainText).toBe("\nabc\n\nABC")
    expect(textarea.cursorOffset).toBe(6)
  })
})
