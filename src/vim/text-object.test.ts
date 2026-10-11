import { afterEach, describe, expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { createRoot } from "solid-js"
import { createVimHandler, type VimEvent } from "./handler"
import { createVimState } from "./state"
import { paragraphTextObjectOperation } from "./motions"

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

  test("paragraph objects stop at whitespace-only separators", async () => {
    for (const separator of [" ", "\t", " \t "]) {
      const result = paragraphTextObjectOperation(
        { plainText: `A\n${separator}\nB`, cursorOffset: 0 } as TextareaRenderable,
        false,
        "d",
      )
      expect(result.span).toEqual({ start: 0, end: 2 })
      expect(result.register).toEqual({ text: "A\n", linewise: true })
    }
    const { textarea, press } = await setup("A\n \nB")
    for (const key of "dip") press(key)
    expect(textarea.plainText).toBe(" \nB")
  })

  for (const [keys, offset, expected, register] of [
    ["d2ap", 0, "C", "A\n\nB\n\n"],
    ["2dap", 0, "C", "A\n\nB\n\n"],
    ["d3ap", 0, "", "A\n\nB\n\nC\n"],
    ["2yap", 0, "A\n\nB\n\nC", "A\n\nB\n\n"],
    ["2dip", 0, "B\n\nC", "A\n\n"],
    ["d2ip", 0, "B\n\nC", "A\n\n"],
    ["d3ip", 0, "\nC", "A\n\nB\n"],
    ["d2ip", 2, "A\n\nC", "\nB\n"],
    ["d2ap", 2, "A", "\nB\n\nC\n"],
  ] as const) {
    test(`${keys} selects counted paragraph objects from offset ${offset}`, async () => {
      const { textarea, state, press } = await setup("A\n\nB\n\nC", offset)
      for (const key of keys) press(key)
      expect(textarea.plainText).toBe(expected)
      expect(state.register()).toEqual({ text: register, linewise: true })
    })
  }

  for (const [original, object, deleted, changed, register] of [
    ["X\n\nA\n ", "ap", "X\n", "X\n\nZ", "A\n \n"],
    ["A\n\nB\n\nC", "2ap", "A", "A\nZ", "\nB\n\nC\n"],
    ["A\n\nB\n", "2ip", "A\n", "A\n\nZ", "B\n\n"],
  ] as const) {
    for (const operation of ["d", "c", "y"]) {
      test(`${operation}${object} handles EOF in ${JSON.stringify(original)}`, async () => {
        const { textarea, state, press } = await setup(original, 3)
        for (const key of operation + object) press(key)
        expect(state.register()).toEqual({ text: register, linewise: true })
        if (operation === "c") {
          textarea.insertText("Z")
          press("escape")
        }
        const expected = operation === "y" ? original : operation === "c" ? changed : deleted
        expect(textarea.plainText).toBe(expected)
        if (operation !== "y") {
          press("u")
          expect(textarea.plainText).toBe(original)
          press(".")
          expect(textarea.plainText).toBe(expected)
        }
      })
    }
  }

  test("an unavailable paragraph count leaves the prompt and register alone", async () => {
    for (const [original, keys, offset] of [
      ["A\n\nB\n\nC", "d4ap", 0],
      ["A\n\nB\n", "d3ip", 3],
    ] as const) {
      const { textarea, state, press } = await setup(original, offset)
      for (const key of keys) press(key)
      expect(textarea.plainText).toBe(original)
      expect(state.register()).toBeNull()
    }
  })

  test("counted paragraph changes preserve whitespace, undo, and repeat", async () => {
    const original = "A\n \nB\n  \nC"
    const { textarea, state, press } = await setup(original)
    for (const key of "c2ap") press(key)
    expect(state.register()).toEqual({ text: "A\n \nB\n  \n", linewise: true })
    textarea.insertText("Z")
    press("escape")
    expect(textarea.plainText).toBe("Z\nC")
    press("u")
    expect(textarea.plainText).toBe(original)
    press(".")
    expect(textarea.plainText).toBe("Z\nC")
  })

  test("cip enters insert mode on an empty prompt without inventing a register", async () => {
    const { textarea, state, press } = await setup("")
    press("c")
    press("i")
    press("p")
    expect(state.mode()).toBe("insert")
    expect(state.register()).toBeNull()
    textarea.insertText("Z")
    press("escape")
    expect(textarea.plainText).toBe("Z")
    press("u")
    expect(textarea.plainText).toBe("")
    press(".")
    expect(textarea.plainText).toBe("Z")
  })

  test("dap removes the block and the blank lines after it", async () => {
    const { textarea, press } = await setup(text, 3)
    press("d")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("X\n\nC")
  })

  test("dip removes only the block lines", async () => {
    const { textarea, press } = await setup(text, 3)
    press("d")
    press("i")
    press("p")
    expect(textarea.plainText).toBe("X\n\n\nC")
  })

  for (const [scope, expected, register] of [
    ["a", "X\n\nZ\nC", "A\nB\n\n"],
    ["i", "X\n\nZ\n\nC", "A\nB\n"],
  ]) {
    test(`c${scope}p preserves the replacement line and full register`, async () => {
      const { textarea, state, press } = await setup(text, 3)
      press("c")
      press(scope)
      press("p")
      expect(state.register()).toEqual({ text: register, linewise: true })
      textarea.insertText("Z")
      press("escape")
      expect(textarea.plainText).toBe(expected)
      press("u")
      expect(textarea.plainText).toBe(text)
      press(".")
      expect(textarea.plainText).toBe(expected)
    })
  }

  test("paragraph objects select the current blank separator", async () => {
    for (const scope of ["i", "a"]) {
      for (const operation of ["d", "c", "y"]) {
        const { textarea, state, press } = await setup(text, 2)
        press(operation)
        press(scope)
        press("p")
        expect(state.register()).toEqual({ text: scope === "i" ? "\n" : "\nA\nB\n", linewise: true })
        if (operation === "c") {
          textarea.insertText("Z")
          press("escape")
          expect(textarea.plainText).toBe(scope === "i" ? "X\nZ\nA\nB\n\nC" : "X\nZ\n\nC")
        } else {
          expect(textarea.plainText).toBe(operation === "y" ? text : scope === "i" ? "X\nA\nB\n\nC" : "X\n\nC")
        }
      }
    }
  })

  test("dip deletes the whole block when the cursor is on a middle line", async () => {
    const { textarea, press } = await setup(text, 5)
    press("d")
    press("i")
    press("p")
    expect(textarea.plainText).toBe("X\n\n\nC")
  })

  test("dap deletes the whole block when the cursor is on a middle line", async () => {
    const { textarea, press } = await setup(text, 5)
    press("d")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("X\n\nC")
  })

  for (const offset of [3, 5]) {
    test(`dip deletes the EOF paragraph linewise from offset ${offset}`, async () => {
      const original = "X\n\nA\nB"
      const { textarea, state, press } = await setup(original, offset)
      press("d")
      press("i")
      press("p")
      expect(textarea.plainText).toBe("X\n")
      expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
      press("u")
      expect(textarea.plainText).toBe(original)
      press(".")
      expect(textarea.plainText).toBe("X\n")
    })
  }

  for (const operation of ["c", "y"]) {
    test(`${operation}ip keeps the preceding separator at EOF`, async () => {
      const original = "X\n\nA\nB"
      const { textarea, state, press } = await setup(original, 3)
      press(operation)
      press("i")
      press("p")
      expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
      if (operation === "c") {
        textarea.insertText("Z")
        press("escape")
        expect(textarea.plainText).toBe("X\n\nZ")
      } else {
        expect(textarea.plainText).toBe(original)
      }
    })
  }

  test("cip Escape preserves the empty replacement line at EOF", async () => {
    const { textarea, state, press } = await setup("X\n\nA\nB", 3)
    press("c")
    press("i")
    press("p")
    press("escape")
    expect(textarea.plainText).toBe("X\n\n")
    expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
  })

  test("dip keeps the trailing empty line after an EOF paragraph", async () => {
    const { textarea, state, press } = await setup("X\n\nA\nB\n", 3)
    press("d")
    press("i")
    press("p")
    expect(textarea.plainText).toBe("X\n\n")
    expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
  })

  for (const operation of ["d", "c", "y"]) {
    test(`${operation}ap includes the preceding separator when the paragraph ends at EOF`, async () => {
      const original = "X\n\nA\nB"
      const { textarea, state, press } = await setup(original, 3)
      press(operation)
      press("a")
      press("p")
      expect(state.register()).toEqual({ text: "\nA\nB\n", linewise: true })
      if (operation === "c") {
        textarea.insertText("Z")
        press("escape")
        expect(textarea.plainText).toBe("X\nZ")
      } else {
        expect(textarea.plainText).toBe(operation === "d" ? "X" : original)
      }
    })
  }

  test("inner objects register a terminal empty line exactly once", async () => {
    for (const original of ["A\nB\n", "X\n"]) {
      for (const operation of ["d", "c", "y"]) {
        const { state, press } = await setup(original, original.length)
        press(operation)
        press("i")
        press("p")
        expect(state.register()).toEqual({ text: "\n", linewise: true })
      }
    }
  })

  test("around paragraph includes the final empty line at EOF", async () => {
    const original = "X\n\nA\nB\n"
    for (const operation of ["d", "c", "y"]) {
      const { textarea, state, press } = await setup(original, 3)
      press(operation)
      press("a")
      press("p")
      expect(state.register()).toEqual({ text: "A\nB\n\n", linewise: true })
      if (operation === "c") {
        textarea.insertText("Z")
        press("escape")
        expect(textarea.plainText).toBe("X\n\nZ")
      } else {
        expect(textarea.plainText).toBe(operation === "d" ? "X\n" : original)
      }
    }
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

  test("yap sets a linewise register for the whole around span", async () => {
    const { textarea, state, press } = await setup(text, 3)
    press("y")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("X\n\nA\nB\n\nC")
    expect(state.register()).toEqual({ text: "A\nB\n\n", linewise: true })
  })

  test("dap consumes all blank lines after the block, keeps the ones above", async () => {
    const { textarea, press } = await setup("X\n\n\nA\n\n\nC", 4)
    press("d")
    press("a")
    press("p")
    expect(textarea.plainText).toBe("X\n\n\nC")
  })

  test("dip leaves all adjacent blanks above and below", async () => {
    const { textarea, press } = await setup("X\n\n\nA\n\n\nC", 4)
    press("d")
    press("i")
    press("p")
    expect(textarea.plainText).toBe("X\n\n\n\n\nC")
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
  test("dal removes the whole buffer", async () => {
    const { textarea, press } = await setup("A\nB\nC", 1)
    press("d")
    press("a")
    press("l")
    expect(textarea.plainText).toBe("")
  })

  test("dil removes the whole buffer", async () => {
    const { textarea, press } = await setup("A\nB\nC", 1)
    press("d")
    press("i")
    press("l")
    expect(textarea.plainText).toBe("")
  })

  test("yal sets a linewise register for the buffer without editing", async () => {
    const { textarea, state, press } = await setup("A\nB", 0)
    press("y")
    press("a")
    press("l")
    expect(textarea.plainText).toBe("A\nB")
    expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
  })

  test("yil sets the same register as yal", async () => {
    const { textarea, state, press } = await setup("A\nB", 0)
    press("y")
    press("i")
    press("l")
    expect(textarea.plainText).toBe("A\nB")
    expect(state.register()).toEqual({ text: "A\nB\n", linewise: true })
  })

  test("whole-buffer registers preserve a final empty line when pasted", async () => {
    for (const scope of ["i", "a"]) {
      for (const operation of ["y", "d", "c"]) {
        const { textarea, state, press } = await setup("A\n", 0)
        press(operation)
        press(scope)
        press("l")
        expect(state.register()).toEqual({ text: "A\n\n", linewise: true })
        if (operation === "c") press("escape")
        textarea.setText("X")
        textarea.cursorOffset = 0
        press("p")
        expect(textarea.plainText).toBe("X\nA\n")
      }
    }
  })

  test("cal deletes the buffer and enters insert mode", async () => {
    const { textarea, state, press } = await setup("A\nB", 0)
    press("c")
    press("a")
    press("l")
    expect(textarea.plainText).toBe("")
    expect(state.mode()).toBe("insert")
  })

  test("dal no-ops on an empty buffer", async () => {
    const { textarea, press } = await setup("", 0)
    press("d")
    press("a")
    press("l")
    expect(textarea.plainText).toBe("")
  })
})
