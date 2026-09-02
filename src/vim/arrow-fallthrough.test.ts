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

function makeEvent(name: string): VimEvent {
  return {
    name,
    sequence: name,
    raw: name,
    shift: false,
    ctrl: false,
    meta: false,
    super: false,
    preventDefault() {},
  }
}

async function setup(text: string, offset = 0, width = 60) {
  const { renderer } = await createTestRenderer({ width, height: 8 })
  renderers.push(renderer)
  const textarea = new TextareaRenderable(renderer, {
    id: `arrow-fallthrough-${renderers.length}`,
    width,
    height: 6,
    initialValue: text,
  })
  renderer.root.add(textarea)
  textarea.cursorOffset = offset

  const handler = createRoot((dispose) => {
    disposers.push(dispose)
    const state = createVimState({ enabled: () => true, initial: () => "normal" })
    return createVimHandler({
      enabled: () => true,
      state,
      textarea: () => textarea,
      submit() {},
      scroll() {},
      jump() {},
    })
  })

  return { textarea, handler }
}

describe("arrow keys in normal mode", () => {
  test("down falls through when the cursor cannot move (single line)", async () => {
    const { handler } = await setup("single line")
    expect(handler.handleKey(makeEvent("down"))).toBe(false)
  })

  test("up falls through when the cursor cannot move (single line)", async () => {
    const { handler } = await setup("single line")
    expect(handler.handleKey(makeEvent("up"))).toBe(false)
  })

  test("down is consumed when the cursor can move down", async () => {
    const { textarea, handler } = await setup("a\nb", 0)
    expect(handler.handleKey(makeEvent("down"))).toBe(true)
    expect(textarea.cursorOffset).toBe(2)
  })

  test("up is consumed when the cursor can move up", async () => {
    const { textarea, handler } = await setup("a\nb", 2)
    expect(handler.handleKey(makeEvent("up"))).toBe(true)
    expect(textarea.cursorOffset).toBe(0)
  })

  test("j/k keep moving the cursor and never fall through", async () => {
    const { handler } = await setup("single line")
    expect(handler.handleKey(makeEvent("j"))).toBe(true)
    expect(handler.handleKey(makeEvent("k"))).toBe(true)
  })
})
