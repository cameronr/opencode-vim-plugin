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

async function setup(text: string, offset = 0, width = 60) {
  const { renderer } = await createTestRenderer({ width, height: 8 })
  renderers.push(renderer)
  const textarea = new TextareaRenderable(renderer, {
    id: `display-motion-${renderers.length}`,
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
      jump(action) {
        if (action === "top") textarea.gotoBufferHome()
        if (action === "bottom") textarea.gotoBufferEnd()
      },
    })
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

  return { textarea, press }
}

describe("display motion column intent", () => {
  test("keeps logical end intent through $gj", async () => {
    const { textarea, press } = await setup(`short\n${"A".repeat(30)}`, 0, 20)

    press("$")
    press("g")
    press("j")

    expect(textarea.cursorOffset).toBe(25)
  })

  test("clears logical end intent when gg resolves", async () => {
    const { textarea, press } = await setup("abc\nlonger")

    press("$")
    press("g")
    press("g")
    press("j")

    expect(textarea.cursorOffset).toBe(4)
  })

  test("keeps display-line end intent through g$gj", async () => {
    const { textarea, press } = await setup("A".repeat(40), 0, 20)

    press("g")
    press("$")
    press("g")
    press("j")

    expect(textarea.cursorOffset).toBe(39)
  })
})
