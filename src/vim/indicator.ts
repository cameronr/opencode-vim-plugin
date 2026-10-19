import { type Accessor } from "solid-js"
import type { createVimState } from "./state"

export function useVimIndicator(input: {
  enabled: Accessor<boolean>
  active: Accessor<boolean>
  state: ReturnType<typeof createVimState>
  copyVisual?: Accessor<undefined | "char" | "line" | "block">
  copySearch?: Accessor<string | undefined>
}) {
  // Plain function, not a createMemo: the v2 TUI renders plugin slot trees
  // once and caches them, and untracked Solid memos can go stale. The value
  // is read imperatively (see syncIndicator in tui.tsx), so it must compute
  // fresh on every call.
  return () => {
    if (!input.enabled() || !input.active()) return
    const key = input.state.pending()
    if (key) return (input.state.pendingDisplay() || key) + ".."
    if (input.state.count()) return input.state.count()
    if (input.state.isCopy()) {
      const search = input.copySearch?.()
      if (search !== undefined) return search
      if (input.copyVisual?.() === "char") return "-- VISUAL --"
      if (input.copyVisual?.() === "line") return "-- VISUAL LINE --"
      if (input.copyVisual?.() === "block") return "-- VISUAL BLOCK --"
      return "-- COPY --"
    }
    if (input.state.mode() === "insert") return "-- INSERT --"
    if (input.state.mode() === "replace") return "-- REPLACE --"
    if (input.state.mode() === "visual-line") return "-- VISUAL LINE --"
    if (input.state.mode() === "visual") return "-- VISUAL --"
  }
}
