// URL advance bookkeeping for turbo_overlay.
//
// `advance: true` on a modal_link_to / drawer_link_to (or a per-type
// config default) pushes a history entry when the overlay opens, so
// the URL bar reflects what the user is looking at and browser-back
// closes the top overlay instead of navigating away from the page
// beneath. Popovers and hints never advance — they're ephemeral and
// shouldn't churn browser history.
//
// State lives at module scope so the bookkeeping survives Stimulus
// disconnect/reconnect and idiomorph re-renders (the dialog node may
// be morphed in place; the controller instance can be re-created;
// the overlay id is the stable key).

// Resolved advance URL set by the click handler before the fetch
// goes out; consumed by the overlay controller when `shown` fires.
const advanceUrls = new Map()

// Overlays we've called history.pushState for. Keyed by overlay id so
// close-path code can ask "did we push for this overlay?" without
// reaching into a possibly-discarded controller instance.
const pushedEntries = new Map()

// Counter of popstates we caused ourselves via `history.back()` and
// must swallow before the popstate handler treats one as user input.
let expectedPopstates = 0

// Read-only accessor for setup.js's `turbo:before-visit` guard.
// Exposed as a function so the value reflects the current count, not
// a snapshot at import time.
export function expectedPopstateCount() {
  return expectedPopstates
}

// True if any currently-tracked overlay entry on the stack has a
// `pushed` record. Used by setup.js to decide whether to cancel a
// Turbo restoration visit that was triggered by popstate over an
// advance-pushed entry.
export function hasPushedOverlayOnStack() {
  if (!stackController || !stackController.entries) return false
  for (const entry of stackController.entries) {
    if (entry && pushedEntries.has(entry.id)) return true
  }
  return false
}

// Live reference to the per-page stack controller. The stack
// Stimulus controller calls `setStackController(this)` on connect and
// `setStackController(null)` on disconnect. Used by the popstate
// handler to walk the stack without reaching into Stimulus internals
// from setup.js (which is not itself a controller).
let stackController = null

export function setStackController(controller) {
  stackController = controller
}

export function getStackController() {
  return stackController
}

export function setAdvanceUrl(id, url) {
  if (!id) return
  if (url) advanceUrls.set(id, url)
  else advanceUrls.delete(id)
}

export function getAdvanceUrl(id) {
  return id ? (advanceUrls.get(id) || null) : null
}

export function clearAdvanceUrl(id) {
  if (id) advanceUrls.delete(id)
}

export function markPushed(id, url, type) {
  if (!id) return
  pushedEntries.set(id, { url, type })
}

export function isPushed(id) {
  return !!(id && pushedEntries.has(id))
}

export function clearPushed(id) {
  if (id) pushedEntries.delete(id)
}

// Count entries from a stack snapshot whose id has a `pushed` record.
// Used by close-path code to detect whether a given close actually
// reduced the live pushed count (and therefore should reverse history).
export function livePushedCount(stackEntries) {
  if (!stackEntries || !stackEntries.length) return 0
  let n = 0
  for (const e of stackEntries) {
    if (e && pushedEntries.has(e.id)) n += 1
  }
  return n
}

export function pushOverlayState(id, type, url) {
  if (typeof window === "undefined" || !window.history) return
  try {
    window.history.pushState(
      { turboOverlay: { id, type } },
      "",
      url
    )
  } catch (_) {
    // pushState can throw on cross-origin URLs; treat as "didn't push"
    // so the close path won't try to reverse a history entry that
    // doesn't exist. The caller is expected to skip markPushed too if
    // this throws — but we're defensive: the caller's surrounding
    // try/catch will handle it.
    throw _
  }
}

export function reverseHistoryForClose() {
  if (typeof window === "undefined" || !window.history) return
  expectedPopstates += 1
  try {
    window.history.back()
  } catch (_) {
    // Same defensive note as pushOverlayState. If back() throws we'll
    // have an over-counted expectedPopstates that one stray popstate
    // (if it ever fires) would swallow. Acceptable.
  }
}

// Wipe state at navigation boundaries. The pushed history entries the
// gem created remain in the session-history backing store — the user
// could still navigate back to them — but the gem no longer tracks
// them, so a popstate landing on one of those URLs after navigation
// is treated as a regular user-initiated history navigation (no
// overlay matches; we no-op).
export function resetHistoryState() {
  advanceUrls.clear()
  pushedEntries.clear()
  expectedPopstates = 0
}

export function registerPopstateHandler() {
  if (typeof window === "undefined") return
  if (window._turboOverlayPopstateRegistered) return
  window._turboOverlayPopstateRegistered = true

  // Two responsibilities:
  //
  //   1. If we caused this popstate via `history.back()` (close path),
  //      just decrement the counter. The matching overlay was already
  //      cleared from `pushedEntries` before history.back().
  //
  //   2. If the user pressed browser-back over an advance overlay's
  //      pushed URL, close the topmost overlay whose id is still in
  //      `pushedEntries`. The overlay's close path sees `_closedByBack`
  //      and skips its own `history.back()` so we don't double-pop.
  //
  // Note: we can't stop Turbo Drive's own popstate handler from
  // running (for window-only events, capture/bubble flags don't
  // change at-target order; Turbo's handler is registered first via
  // its own import order and runs first). The protection against
  // Turbo's `historyPoppedWithEmptyState` → `before-cache` → teardown
  // chain lives in setup.js, which gates `tearDownAllOverlays` on
  // whether a real Turbo visit is actually in progress.
  window.addEventListener("popstate", () => {
    if (expectedPopstates > 0) {
      expectedPopstates -= 1
      return
    }
    const stack = stackController
    if (!stack || !stack.entries) return
    for (let i = stack.entries.length - 1; i >= 0; i--) {
      const entry = stack.entries[i]
      if (!entry || !entry.controller) continue
      if (!pushedEntries.has(entry.id)) continue
      entry.controller._closedByBack = true
      if (typeof entry.controller.close === "function") {
        entry.controller.close()
      }
      return
    }
  })
}
