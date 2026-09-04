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

async function setup(text: string, offset = 0) {
  const { renderer } = await createTestRenderer({ width: 80, height: 8 })
  renderers.push(renderer)
  const textarea = new TextareaRenderable(renderer, {
    id: `text-object-${renderers.length}`,
    width: 80,
    height: 6,
    initialValue: text,
  })
  renderer.root.add(textarea)
  textarea.cursorOffset = offset

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

  return { textarea, state, press }
}

describe("any quote text objects", () => {
  test("diq deletes the inside of a double-quoted pair", async () => {
    const { textarea, press } = await setup('a "b" c', 0)
    press("d")
    press("i")
    press("q")
    expect(textarea.plainText).toBe('a "" c')
  })

  test("daq deletes the pair and the space after it", async () => {
    const { textarea, press } = await setup('a "b" c', 0)
    press("d")
    press("a")
    press("q")
    expect(textarea.plainText).toBe("a c")
  })

  test("diq matches single quotes", async () => {
    const { textarea, press } = await setup("a 'b' c", 0)
    press("d")
    press("i")
    press("q")
    expect(textarea.plainText).toBe("a '' c")
  })

  test("diq matches backticks", async () => {
    const { textarea, press } = await setup("a `b` c", 0)
    press("d")
    press("i")
    press("q")
    expect(textarea.plainText).toBe("a `` c")
  })

  test("diq prefers the double quote when both kinds are present", async () => {
    const { textarea, press } = await setup('a \'x\' "y"', 0)
    press("d")
    press("i")
    press("q")
    expect(textarea.plainText).toBe('a \'x\' ""')
  })

  test("diq skips escaped quotes", async () => {
    const { textarea, press } = await setup('a "b\\"c" d', 0)
    press("d")
    press("i")
    press("q")
    expect(textarea.plainText).toBe('a "" d')
  })

  test("diq no-ops when no quote pair is on the line", async () => {
    const { textarea, press } = await setup("plain text", 0)
    press("d")
    press("i")
    press("q")
    expect(textarea.plainText).toBe("plain text")
  })

  test("yiq sets a charwise register without editing", async () => {
    const { textarea, state, press } = await setup('a "b" c', 0)
    press("y")
    press("i")
    press("q")
    expect(textarea.plainText).toBe('a "b" c')
    expect(state.register()).toEqual({ text: "b", linewise: false })
  })

  test("yaq sets a charwise register for the pair with spaces", async () => {
    const { textarea, state, press } = await setup('a "b" c', 0)
    press("y")
    press("a")
    press("q")
    expect(textarea.plainText).toBe('a "b" c')
    expect(state.register()).toEqual({ text: '"b" ', linewise: false })
  })
})

describe("paragraph text objects", () => {
  const text = "X\n\nA\nB\n\nC"

  test("dap removes the block and its bordering blank lines", async () => {
    const { textarea, press } = await setup(text, 3)
    press("d")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("X\nC")
  })

  test("dip removes only the block lines", async () => {
    const { textarea, press } = await setup(text, 3)
    press("d")
    press("i")
    press("p")
    expect(textarea.plainText).toBe("X\n\n\nC")
  })

  test("dap targets the next block when the cursor is on a blank line", async () => {
    const { textarea, press } = await setup(text, 2)
    press("d")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("X\nC")
  })

  test("dap removes a single-paragraph buffer", async () => {
    const { textarea, press } = await setup("A\nB", 0)
    press("d")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("")
  })

  test("dap no-ops on an all-blank buffer", async () => {
    const { textarea, press } = await setup("\n\n", 0)
    press("d")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("\n\n")
  })

  test("dip sets a linewise register for the block", async () => {
    const { textarea, state, press } = await setup(text, 3)
    press("d")
    press("i")
    press("p")
    expect(textarea.plainText).toBe("X\n\n\nC")
    expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
  })

  test("dap consumes a trailing blank at end of buffer", async () => {
    const { textarea, press } = await setup("A\n\n", 0)
    press("d")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("")
  })

  test("dip keeps a trailing blank at end of buffer", async () => {
    const { textarea, press } = await setup("A\n\n", 0)
    press("d")
    press("i")
    press("p")
    expect(textarea.plainText).toBe("\n")
  })
})

describe("whole buffer text objects", () => {
  test("dag removes the whole buffer", async () => {
    const { textarea, press } = await setup("A\nB\nC", 1)
    press("d")
    press("a")
    press("g")
    expect(textarea.plainText).toBe("")
  })

  test("dig removes the whole buffer", async () => {
    const { textarea, press } = await setup("A\nB\nC", 1)
    press("d")
    press("i")
    press("g")
    expect(textarea.plainText).toBe("")
  })

  test("yag sets a linewise register for the buffer without editing", async () => {
    const { textarea, state, press } = await setup("A\nB", 0)
    press("y")
    press("a")
    press("g")
    expect(textarea.plainText).toBe("A\nB")
    expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
  })

  test("yig sets the same register as yag", async () => {
    const { textarea, state, press } = await setup("A\nB", 0)
    press("y")
    press("i")
    press("g")
    expect(textarea.plainText).toBe("A\nB")
    expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
  })

  test("cag deletes the buffer and enters insert mode", async () => {
    const { textarea, state, press } = await setup("A\nB", 0)
    press("c")
    press("a")
    press("g")
    expect(textarea.plainText).toBe("")
    expect(state.mode()).toBe("insert")
  })

  test("dag no-ops on an empty buffer", async () => {
    const { textarea, press } = await setup("", 0)
    press("d")
    press("a")
    press("g")
    expect(textarea.plainText).toBe("")
  })
})
