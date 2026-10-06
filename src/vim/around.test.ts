import { afterEach, describe, expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { createRoot } from "solid-js"
import { createVimHandler, type VimEvent } from "./handler"
import { createVimState } from "./state"

// Expected values were captured from real nvim (0.12.5) with a headless
// script; see the around-audit notes. Paragraph (dap/dip) is not covered
// here: it intentionally follows the prompt-oriented spec in
// text-object.test.ts instead of nvim's downward-only rule.

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
    id: `around-${renderers.length}`,
    width: 80,
    height: 6,
    initialValue: text,
  })
  renderer.root.add(textarea)
  textarea.cursorOffset = offset

  const { handler } = createRoot((dispose) => {
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
    return { handler }
  })

  function press(name: string, options: Partial<VimEvent> = {}) {
    const event: VimEvent = {
      name,
      sequence: options.sequence ?? name,
      raw: options.raw ?? options.sequence ?? name,
      shift: options.shift ?? false,
      ctrl: false,
      meta: false,
      super: false,
      preventDefault() {},
    }
    expect(handler.handleKey(event)).toBe(true)
  }

  return { textarea, press }
}

describe("word text objects", () => {
  test("daw consumes the whole trailing space run", async () => {
    const { textarea, press } = await setup("a b  c", 2)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a c")
  })

  test("daw on a word at EOL consumes the leading spaces, not the newline", async () => {
    const { textarea, press } = await setup("a b\n c", 2)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a\n c")
  })

  test("daw on a word at EOL keeps the newline when the next line starts with a word", async () => {
    const { textarea, press } = await setup("a b\nc d", 2)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a\nc d")
  })

  test("daw on a word at EOL keeps blank lines below", async () => {
    const { textarea, press } = await setup("a b\n\nc", 2)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a\n\nc")
  })

  test("daw on a word before punctuation consumes the leading spaces", async () => {
    const { textarea, press } = await setup("a b.c", 2)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a.c")
  })

  test("daw on a mid-line blank run takes the run and the next word only", async () => {
    const { textarea, press } = await setup("a  b c", 1)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a c")
  })

  test("daw on a blank run at EOL crosses the newline to the next word", async () => {
    const { textarea, press } = await setup("a  \nb c", 1)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a c")
  })

  test("daw on a blank run at EOL stops at a blank line below", async () => {
    const { textarea, press } = await setup("a  \n\nc", 1)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a\nc")
  })

  test("daw on a blank run at EOL crosses whitespace-only lines", async () => {
    const { textarea, press } = await setup("a  \n \nb c", 1)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a c")
  })

  test("daw on a trailing blank run at the end of the buffer is a no-op", async () => {
    const { textarea, press } = await setup("a  \n", 1)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe("a  \n")
  })

  test("daw on a blank run at the start of the buffer takes the run and the word", async () => {
    const { textarea, press } = await setup("  b c", 1)
    press("d")
    press("a")
    press("w")
    expect(textarea.plainText).toBe(" c")
  })

  test("diw on a blank run takes the run only", async () => {
    const { textarea, press } = await setup("a  b c", 1)
    press("d")
    press("i")
    press("w")
    expect(textarea.plainText).toBe("ab c")
  })

  test("daW consumes the big word and its trailing spaces", async () => {
    const { textarea, press } = await setup("a b-c d", 2)
    press("d")
    press("a")
    press("w", { shift: true })
    expect(textarea.plainText).toBe("a d")
  })
})

describe("quote text objects", () => {
  test("da\" consumes the trailing space after the pair", async () => {
    const { textarea, press } = await setup('a "b" c', 3)
    press("d")
    press("a")
    press('"')
    expect(textarea.plainText).toBe("a c")
  })

  test("da\" consumes the whole trailing space run", async () => {
    const { textarea, press } = await setup('a "b"  c', 3)
    press("d")
    press("a")
    press('"')
    expect(textarea.plainText).toBe("a c")
  })

  test("da\" at EOL consumes the leading space instead", async () => {
    const { textarea, press } = await setup('a "b"\nc', 3)
    press("d")
    press("a")
    press('"')
    expect(textarea.plainText).toBe("a\nc")
  })

  test("da\" before a non-blank consumes the leading space", async () => {
    const { textarea, press } = await setup('a "b"c', 3)
    press("d")
    press("a")
    press('"')
    expect(textarea.plainText).toBe("ac")
  })

  test("da' follows the same rule", async () => {
    const { textarea, press } = await setup("a 'b' c", 3)
    press("d")
    press("a")
    press("'")
    expect(textarea.plainText).toBe("a c")
  })

  test("da` follows the same rule", async () => {
    const { textarea, press } = await setup("a `b` c", 3)
    press("d")
    press("a")
    press("`")
    expect(textarea.plainText).toBe("a c")
  })
})

describe("bracket text objects", () => {
  test("da( keeps the spaces outside the pair", async () => {
    const { textarea, press } = await setup("a (b ) c", 2)
    press("d")
    press("a")
    press("(")
    expect(textarea.plainText).toBe("a  c")
  })

  test("da( on an empty pair removes only the pair", async () => {
    const { textarea, press } = await setup("a ( ) c", 2)
    press("d")
    press("a")
    press("(")
    expect(textarea.plainText).toBe("a  c")
  })

  test("da( at EOL keeps the newline", async () => {
    const { textarea, press } = await setup("a (b)\nc", 2)
    press("d")
    press("a")
    press("(")
    expect(textarea.plainText).toBe("a \nc")
  })

  test("da( before a non-blank removes only the pair", async () => {
    const { textarea, press } = await setup("a (b)c", 2)
    press("d")
    press("a")
    press("(")
    expect(textarea.plainText).toBe("a c")
  })

  test("da( on a multiline pair takes the whole pair", async () => {
    const { textarea, press } = await setup("a (\nb\n)\n c", 2)
    press("d")
    press("a")
    press("(")
    expect(textarea.plainText).toBe("a \n c")
  })

  test("da( on a multiline pair keeps the space after the close", async () => {
    const { textarea, press } = await setup("a (\nb\n) c", 2)
    press("d")
    press("a")
    press("(")
    expect(textarea.plainText).toBe("a  c")
  })

  test("da{ on a multiline pair takes the whole pair", async () => {
    const { textarea, press } = await setup("a {\nb\n} c", 2)
    press("d")
    press("a")
    press("{")
    expect(textarea.plainText).toBe("a  c")
  })

  test("di( on a single-line pair removes the content only", async () => {
    const { textarea, press } = await setup("a (b) c", 2)
    press("d")
    press("i")
    press("(")
    expect(textarea.plainText).toBe("a () c")
  })

  test("di( on a multiline pair skips the leading newline and drops the content line", async () => {
    const { textarea, press } = await setup("a (\nb\n)\n c", 2)
    press("d")
    press("i")
    press("(")
    expect(textarea.plainText).toBe("a (\n)\n c")
  })

  test("ci( on a multiline pair keeps the content line for the cursor", async () => {
    const { textarea, press } = await setup("a (\nb\n)\n c", 2)
    press("c")
    press("i")
    press("(")
    expect(textarea.plainText).toBe("a (\n\n)\n c")
  })
})
