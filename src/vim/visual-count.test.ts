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

function rowColToOffset(text: string, row: number, col: number) {
  const lines = text.split("\n")
  let offset = 0
  for (let index = 0; index < row; index++) offset += lines[index]!.length + 1
  return offset + col
}

async function setup(text: string) {
  const { renderer } = await createTestRenderer({ width: 80, height: 8 })
  renderers.push(renderer)
  const textarea = new TextareaRenderable(renderer, {
    id: `visual-count-${renderers.length}`,
    width: 80,
    height: 6,
    initialValue: text,
  })
  renderer.root.add(textarea)

  const { handler, state } = createRoot((dispose) => {
    disposers.push(dispose)
    const state = createVimState({ enabled: () => true, initial: () => "normal" })
    const handler = createVimHandler({
      enabled: () => true,
      state,
      textarea: () => textarea,
      submit() {},
      scroll() {},
      jump() {},
    })
    return { handler, state }
  })

  function press(name: string, options: Partial<VimEvent> = {}) {
    const event: VimEvent = {
      name,
      sequence: name,
      raw: name,
      shift: false,
      ctrl: false,
      meta: false,
      super: false,
      preventDefault() {},
      ...options,
    }
    expect(handler.handleKey(event)).toBe(true)
  }

  return { textarea, state, press }
}

describe("visual mode counts", () => {
  test("visual character motions support counts", async () => {
    const text = "one\ntwo\nthree\nfour"
    const { textarea, state, press } = await setup(text)

    press("v")
    press("2")
    press("j")

    expect(textarea.cursorOffset).toBe(rowColToOffset(text, 2, 0))
    expect(textarea.editorView.getSelection()).toEqual({
      start: 0,
      end: rowColToOffset(text, 2, 0) + 1,
    })
    expect(state.count()).toBe("")
  })

  test("visual line motions support counts", async () => {
    const text = "one\ntwo\nthree\nfour"
    const { textarea, state, press } = await setup(text)

    press("v", { shift: true, sequence: "V" })
    press("2")
    press("j")

    expect(textarea.cursorOffset).toBe(rowColToOffset(text, 2, 0))
    expect(textarea.editorView.getSelection()).toEqual({ start: 0, end: 14 })
    expect(state.count()).toBe("")
  })

  test("counted visual word motion extends the selection", async () => {
    const text = "one two three four"
    const { textarea, press } = await setup(text)

    press("v")
    press("2")
    press("w")

    expect(textarea.cursorOffset).toBe(text.indexOf("three"))
    expect(textarea.editorView.getSelection()).toEqual({
      start: 0,
      end: text.indexOf("three") + 1,
    })
  })

  test("escape exits visual mode with a pending count", async () => {
    const { state, press } = await setup("one\ntwo\nthree")

    press("v")
    press("2")
    press("escape")

    expect(state.mode()).toBe("normal")
    expect(state.count()).toBe("")
  })
})
