import { afterEach, describe, expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { createRoot } from "solid-js"
import { createVimHandler, type VimEvent } from "./handler"
import { createVimState, type VimRegister } from "./state"

const renderers: TestRenderer[] = []
const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  for (const renderer of renderers.splice(0)) renderer.destroy()
})

async function setup(text: string, register?: VimRegister) {
  const { renderer } = await createTestRenderer({ width: 80, height: 8 })
  renderers.push(renderer)
  const textarea = new TextareaRenderable(renderer, {
    id: `paste-count-${renderers.length}`,
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
      ...(register ? { register: () => register } : {}),
      submit() {},
      scroll() {},
      jump() {},
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

describe("counted linewise paste", () => {
  test("2p leaves the cursor on the first inserted line", async () => {
    const { textarea, press } = await setup("a\nb")

    press("y")
    press("y")
    press("2")
    press("p")

    expect(textarea.plainText).toBe("a\na\na\nb")
    expect(textarea.cursorOffset).toBe(2)
  })

  test("2P leaves the cursor on the first inserted line", async () => {
    const { textarea, press } = await setup("a\nb")

    press("y")
    press("y")
    press("j")
    press("2")
    press("p", { shift: true, sequence: "P" })

    expect(textarea.plainText).toBe("a\na\na\nb")
    expect(textarea.cursorOffset).toBe(2)
  })

  test("2p keeps repeated multiline registers contiguous", async () => {
    const { textarea, press } = await setup("a\nb\nc")

    press("2")
    press("y")
    press("y")
    press("j")
    press("j")
    press("2")
    press("p")

    expect(textarea.plainText).toBe("a\nb\nc\na\nb\na\nb")
    expect(textarea.cursorOffset).toBe(6)
  })

  test("2P keeps repeated multiline registers contiguous", async () => {
    const { textarea, press } = await setup("a\nb\nc")

    press("2")
    press("y")
    press("y")
    press("j")
    press("j")
    press("2")
    press("p", { shift: true, sequence: "P" })

    expect(textarea.plainText).toBe("a\nb\na\nb\na\nb\nc")
    expect(textarea.cursorOffset).toBe(4)
  })

  test("2p handles a trailing register newline in the middle of a buffer", async () => {
    const { textarea, press } = await setup("c\nd", { text: "a\nb\n", linewise: true })

    press("2")
    press("p")

    expect(textarea.plainText).toBe("c\na\nb\na\nb\nd")
    expect(textarea.cursorOffset).toBe(2)
  })

  test("2P handles a trailing register newline in the middle of a buffer", async () => {
    const { textarea, press } = await setup("c\nd", { text: "a\nb\n", linewise: true })

    press("2")
    press("p", { shift: true, sequence: "P" })

    expect(textarea.plainText).toBe("a\nb\na\nb\nc\nd")
    expect(textarea.cursorOffset).toBe(0)
  })
})
