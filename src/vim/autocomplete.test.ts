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

async function setup(text: string, autocomplete: (() => false | "@" | "/") | undefined) {
  const { renderer } = await createTestRenderer({ width: 80, height: 8 })
  renderers.push(renderer)
  const textarea = new TextareaRenderable(renderer, {
    id: `autocomplete-${renderers.length}`,
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
      copySearchStart: () => false,
      autocomplete,
    })
    return { handler, state }
  })

  function press(name: string, shift = false) {
    const event: VimEvent = {
      name,
      sequence: name,
      raw: name,
      shift,
      ctrl: false,
      meta: false,
      super: false,
      preventDefault() {},
    }
    return handler.handleKey(event)
  }

  return { textarea, state, press }
}

describe("normal mode slash and at dispatch", () => {
  test("consumes / without inserting when autocomplete declines", async () => {
    const { textarea, state, press } = await setup("", () => false)
    expect(press("slash")).toBe(true)
    expect(textarea.plainText).toBe("")
    expect(state.mode()).toBe("normal")
  })

  test("consumes @ without inserting when autocomplete declines", async () => {
    const { textarea, state, press } = await setup("", () => false)
    expect(press("at", true)).toBe(true)
    expect(textarea.plainText).toBe("")
    expect(state.mode()).toBe("normal")
  })

  test("consumes / without inserting when autocomplete is absent", async () => {
    const { textarea, state, press } = await setup("", undefined)
    expect(press("slash")).toBe(true)
    expect(textarea.plainText).toBe("")
    expect(state.mode()).toBe("normal")
  })

  test("inserts / and enters insert mode when autocomplete accepts", async () => {
    const { textarea, state, press } = await setup("", () => "/")
    expect(press("slash")).toBe(true)
    expect(textarea.plainText).toBe("/")
    expect(state.mode()).toBe("insert")
  })

  test("inserts @ and enters insert mode when autocomplete accepts", async () => {
    const { textarea, state, press } = await setup("", () => "@")
    expect(press("at", true)).toBe(true)
    expect(textarea.plainText).toBe("@")
    expect(state.mode()).toBe("insert")
  })

  test("does not insert when the prompt is not empty", async () => {
    const { textarea, state, press } = await setup("hi", () => "/")
    expect(press("slash")).toBe(true)
    expect(textarea.plainText).toBe("hi")
    expect(state.mode()).toBe("normal")
  })
})
