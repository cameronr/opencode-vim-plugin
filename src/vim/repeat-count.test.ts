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
    id: `repeat-count-${renderers.length}`,
    width: 80,
    height: 6,
    initialValue: text,
  })
  renderer.root.add(textarea)

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

  function press(name: string) {
    const event: VimEvent = {
      name,
      sequence: name,
      raw: name,
      shift: false,
      ctrl: false,
      meta: false,
      super: false,
      preventDefault() {},
    }
    expect(handler.handleKey(event)).toBe(true)
  }

  return { textarea, press }
}

describe("dot repeat counts", () => {
  test("does not multiply a previously counted change", async () => {
    const { textarea, press } = await setup("one two three four five six seven eight nine ten")

    press("3")
    press("d")
    press("w")
    press("2")
    press(".")

    expect(textarea.plainText).toBe("seven eight nine ten")
  })
})
