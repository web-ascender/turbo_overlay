import { computePopoverPosition } from "turbo_overlay/popover_position"
import {
  setAdvanceUrl, clearAdvanceUrl, resetHistoryState, registerPopstateHandler,
  expectedPopstateCount, hasPushedOverlayOnStack
} from "turbo_overlay/history"

// Global wiring for turbo_overlay.
//
// This module owns everything that's not bound to a single overlay
// element: the Turbo.StreamActions.overlay action, the document-level
// click/submit/turbo:before-fetch-request hooks that inject overlay
// request headers and spawn loading placeholders, the loading-frame
// morph/cleanup lifecycle, the back/forward cache teardown, and the
// shared registries that the Stimulus controllers read from.
//
// Self-bootstraps on import: every register*() is idempotent (guarded
// by a window._turboOverlay*Registered flag), so importing this module
// from `index.js` (which `register(application)` does for you) is
// enough. The Stimulus controllers don't re-run setup on connect.

// Module-scoped registry mapping a popover's overlay id to the element
// that triggered it. The dialog's controller looks up its anchor here
// on connect so the trigger reference never has to round-trip to the
// server.
const popoverTriggers = new Map()

// Overlay ids whose loading placeholder the user dismissed before the
// server response arrived. We always try to abort the in-flight fetch
// via AbortController so the response never lands, but the set is a
// belt-and-suspenders fallback for the (theoretical) case where the
// response is already in `before-stream-render` when the user clicks
// dismiss.
const dismissedLoadingIds = new Set()

// AbortController per overlay-id keyed in-flight request. Lives long
// enough to cancel the fetch when the user closes the loading
// placeholder; cleaned up on response (success or failure), on visit,
// and on morph-in.
const inflightAborts = new Map()

// Tracks whether `turbo:before-cache` is firing inside a real visit
// (link click, form submit, Turbo.visit, popstate that carries
// Turbo's restoration state) or inside Turbo Drive's
// `historyPoppedWithEmptyState` path (popstate over an entry that
// lacks `state.turbo` — e.g. one the gem pushed for an advance
// overlay). Only the visit path should run `tearDownAllOverlays`.
let _realVisitInProgress = false

export function getPopoverTrigger(id) {
  return popoverTriggers.get(id) || null
}

export function clearPopoverTrigger(id) {
  popoverTriggers.delete(id)
}

function generateOverlayId() {
  return "ov-" + Math.random().toString(36).slice(2, 10)
}

function cssEscape(value) {
  return (window.CSS && typeof window.CSS.escape === "function")
    ? window.CSS.escape(value)
    : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
}

// Resolve the URL the gem should push for an advance-eligible trigger.
// Modal/drawer triggers participate; popovers and hints never do.
//
// Resolution order:
//   1. Type is "popover"/"hint"           → null (hard rule).
//   2. data-turbo-overlay-advance="false" → null (explicit opt-out).
//   3. data-turbo-overlay-advance="true"  → link.href.
//   4. data-turbo-overlay-advance="/foo"  → "/foo".
//   5. Attribute absent → consult the stack's per-type default
//      attribute (data-turbo-overlay-advance-modal /
//      -advance-drawer): "true" → link.href; anything else → null.
function resolveAdvanceUrl(link) {
  const type = link && link.dataset && link.dataset.turboOverlay
  if (type !== "modal" && type !== "drawer") return null

  const explicit = link.dataset.turboOverlayAdvance
  if (explicit === "false") return null
  if (explicit === "true")  return link.href || null
  if (typeof explicit === "string" && explicit.length > 0) return explicit

  const stack = document.querySelector("[data-controller~='turbo-overlay-stack']")
  if (!stack) return null
  const fromStack = stack.dataset[`turboOverlayAdvance${type === "modal" ? "Modal" : "Drawer"}`]
  if (fromStack === "true") return link.href || null
  return null
}

function findLoadingFrame(id) {
  if (!id) return null
  return document.querySelector(`[data-turbo-overlay-loading-id="${cssEscape(id)}"]`)
}

function removeLoadingOverlay(id) {
  const frame = findLoadingFrame(id)
  if (!frame) return
  const dialog = frame.querySelector("dialog")
  if (dialog && dialog.open) {
    try { dialog.close() } catch (_) { /* ignore */ }
  }
  frame.remove()
  inflightAborts.delete(id)
}

function clearAllLoadingOverlays() {
  const frames = document.querySelectorAll("[data-turbo-overlay-loading-id]")
  frames.forEach((frame) => {
    const dialog = frame.querySelector("dialog")
    if (dialog && dialog.open) {
      try { dialog.close() } catch (_) { /* ignore */ }
    }
    frame.remove()
  })
  inflightAborts.forEach((aborter) => {
    try { aborter.abort() } catch (_) { /* ignore */ }
  })
  inflightAborts.clear()
  dismissedLoadingIds.clear()
}

// Rip out every overlay frame (live + loading) before Turbo snapshots
// the page for its cache. Dialog `showModal()` top-layer membership is
// per-document and lost across navigations; without this teardown, a
// back/forward restore would bring back a `<dialog open>` whose top-
// layer state is gone — rendering as an inline block with no backdrop,
// no focus trap, and an ESC key that no longer fires native `cancel`.
//
// We also clear the popover trigger registry: it points at <a> elements
// in the live DOM, and after a navigation those references would either
// be stale (detached nodes from a previous page) or actively wrong (a
// re-used overlay id resolving to the prior page's anchor). The hover/
// loading registries follow the same rationale via clearAllLoadingOverlays.
function tearDownAllOverlays() {
  const frames = document.querySelectorAll("turbo-frame.turbo-overlay-frame")
  frames.forEach((frame) => {
    const dialog = frame.querySelector("dialog")
    if (dialog && dialog.open) {
      try { dialog.close() } catch (_) { /* ignore */ }
    }
    frame.remove()
  })
  inflightAborts.forEach((aborter) => {
    try { aborter.abort() } catch (_) { /* ignore */ }
  })
  inflightAborts.clear()
  dismissedLoadingIds.clear()
  popoverTriggers.clear()
  resetHistoryState()
}

// Tear down a same-id overlay frame still in the DOM so a re-click on
// its trigger can spawn a fresh placeholder without colliding on the
// `turbo_overlay_<type>_<id>` frame id. Drives the registered
// controller's close path (synchronous unregister + listener cleanup),
// aborts any in-flight load for that id, and force-removes the frame
// so we don't have to wait on a 400ms close animation.
function teardownExistingOverlayFrame(frame, id) {
  window.dispatchEvent(new CustomEvent("turbo-overlay:close", { detail: { id } }))

  const aborter = inflightAborts.get(id)
  if (aborter) {
    try { aborter.abort() } catch (_) { /* ignore */ }
    inflightAborts.delete(id)
  }
  dismissedLoadingIds.delete(id)

  if (frame.parentNode) {
    const dialog = frame.querySelector("dialog")
    if (dialog && dialog.open) {
      try { dialog.close() } catch (_) { /* ignore */ }
    }
    frame.remove()
  }
}

// Clone the matching `turbo_overlay_loading_<type>_template` into the
// stack and open it immediately. Inherits the trigger's link options
// (backdrop, drawer position, close button suppression, popover
// position/align/offset) so the placeholder reads visually the same as
// the eventual chrome.
//
// The placeholder dialog is wrapped in a `<turbo-frame>` that matches
// the id the server will eventually render. When the real response
// arrives, `before-stream-render` morphs the new dialog's attributes
// and children INTO this same dialog node so the overlay never closes
// and re-opens — the entry animation only plays once, when the
// placeholder first appears.
function spawnLoadingOverlay(link) {
  const type = link.dataset.turboOverlay
  const id   = link.dataset.turboOverlayId
  if (!type || !id) return

  const template = document.getElementById(`turbo_overlay_loading_${type}_template`)
  if (!template || !template.content) return

  const stack = document.querySelector("[data-controller~='turbo-overlay-stack']")
  if (!stack) return

  const fragment = template.content.cloneNode(true)
  const root = fragment.firstElementChild
  if (!root) return

  const backdrop = link.dataset.turboOverlayBackdrop !== "false"
  if (!backdrop) root.classList.add("turbo-overlay--no-backdrop")

  if (type === "drawer") {
    const position = link.dataset.turboOverlayPosition
    if (position) {
      root.classList.remove(
        "turbo-overlay--drawer-right",
        "turbo-overlay--drawer-left",
        "turbo-overlay--drawer-top",
        "turbo-overlay--drawer-bottom"
      )
      root.classList.add(`turbo-overlay--drawer-${position}`)
    }
  }

  if (link.dataset.turboOverlayClose === "false") {
    root.dataset.turboOverlayClose = "false"
  }

  const frame = document.createElement("turbo-frame")
  frame.id = `turbo_overlay_${type}_${id}`
  frame.className = "turbo-overlay-frame"
  frame.dataset.turboOverlayLoadingId = id
  frame.dataset.turboOverlayLoadingType = type
  frame.appendChild(root)

  stack.appendChild(frame)

  if (root.tagName === "DIALOG") {
    const useModal = (type === "modal") || (type === "drawer" && backdrop)
    // Popovers opened from inside an existing modal dialog must
    // themselves be modal. The HTML inertness algorithm blocks every
    // non-descendant of the topmost modal dialog from receiving input,
    // even top-layer popovers added afterwards. Switching to showModal
    // makes the popover the topmost modal so it stays interactive;
    // transparent ::backdrop CSS preserves the non-modal visual feel.
    //
    // Non-modal drawers are *not* auto-promoted: the UA `dialog:modal`
    // stylesheet would override the gem's `.turbo-overlay--drawer-right`
    // (etc.) inset rules and re-center the drawer in the viewport.
    // Opening a non-modal drawer from inside a modal is documented as
    // unsupported — the parent modal blocks page interaction anyway, so
    // the "non-modal" semantic doesn't really apply in that context.
    const popoverNeedsModal = type === "popover" &&
                              !!document.querySelector("dialog:modal")
    try {
      if (useModal || popoverNeedsModal) root.showModal()
      else if (type === "popover") root.showPopover()
      else root.show()
    } catch (_) {
      root.setAttribute("open", "")
    }
  }

  attachLoadingDismissHandlers(root, frame, id)

  if (type === "popover") {
    positionLoadingPopover(root, link)
  }
}

// Loading placeholders have no Stimulus controller (the chrome partial
// is rendered with `loading: true`, which strips data-controller and
// data-action). Dismissal is wired directly here: ESC fires native
// `cancel` on modal dialogs; clicking the dialog itself
// (target === dialog) is a backdrop click. On dismiss we abort the
// in-flight fetch so the response never lands. The class guard makes
// the listeners no-op after a morph swaps the placeholder into the
// live overlay (the live dialog handles its own ESC/backdrop via the
// Stimulus controller).
function attachLoadingDismissHandlers(dialog, frame, id) {
  if (!dialog || !frame || !id) return

  const dismiss = (event) => {
    if (!dialog.classList.contains("turbo-overlay--loading")) return
    if (event && typeof event.preventDefault === "function") event.preventDefault()

    const aborter = inflightAborts.get(id)
    if (aborter) {
      try { aborter.abort() } catch (_) { /* ignore */ }
      inflightAborts.delete(id)
    }
    dismissedLoadingIds.add(id)

    if (dialog.tagName === "DIALOG") {
      if (dialog.classList.contains("turbo-overlay--popover")) {
        try { dialog.hidePopover() } catch (_) { /* ignore */ }
      } else if (dialog.open) {
        try { dialog.close() } catch (_) { /* ignore */ }
      }
    }
    frame.remove()
  }

  dialog.addEventListener("cancel", dismiss)

  if (dialog.tagName === "DIALOG") {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dismiss(event)
    })
  }
}

function positionLoadingPopover(root, link) {
  // Normalize the dialog's positioning BEFORE measuring — see comment
  // in overlay_controller.js#_positionPopover. UA [popover] /
  // dialog:modal styles set inset:0 with width:auto, which stretches
  // the dialog and corrupts the auto-flip math if measured first.
  root.style.position = "fixed"
  root.style.right    = "auto"
  root.style.bottom   = "auto"
  root.style.margin   = "0"

  const anchorRect = link.getBoundingClientRect()
  const dialogRect = root.getBoundingClientRect()
  const viewport = {
    width:  document.documentElement.clientWidth,
    height: document.documentElement.clientHeight
  }
  const position = link.dataset.turboOverlayPosition || "bottom"
  const align    = link.dataset.turboOverlayAlign    || "start"
  const offsetRaw = link.dataset.turboOverlayOffset
  const offset    = offsetRaw == null ? 4 : parseInt(offsetRaw, 10) || 0

  const { top, left } = computePopoverPosition({
    anchor: anchorRect,
    dialog: dialogRect,
    viewport,
    position, align, offset,
    autoFlip: true
  })

  root.style.top  = `${top}px`
  root.style.left = `${left}px`
}

// Morph the placeholder dialog so it becomes the live overlay:
// transfer every attribute from the incoming dialog (except `open`,
// which the placeholder already has) and replace the children. The
// dialog DOM node never closes — it stays in the top layer (or at its
// fixed position) the entire time — so the overlay's open animation
// only plays once, when the placeholder first appeared.
//
// Stimulus's MutationObserver picks up `data-controller="turbo-overlay"`
// landing on the dialog and connects the controller. The controller's
// connect path already handles "dialog is already open" by skipping
// showModal/show.
function morphDialogInPlace(existing, incoming) {
  // `open` already drives the placeholder's open state — re-applying
  // it from the server payload is a no-op at best and breaks top-layer
  // identity at worst. `style` holds the popover's inline anchor
  // positioning, which we want to keep until the controller re-runs
  // _positionPopover; the partial never emits a style attribute, so
  // skipping it costs nothing.
  const incomingAttrNames = new Set()
  for (const attr of Array.from(incoming.attributes)) {
    if (attr.name === "open" || attr.name === "style") continue
    incomingAttrNames.add(attr.name)
    if (existing.getAttribute(attr.name) !== attr.value) {
      existing.setAttribute(attr.name, attr.value)
    }
  }
  for (const attr of Array.from(existing.attributes)) {
    if (attr.name === "open" || attr.name === "style") continue
    if (!incomingAttrNames.has(attr.name)) existing.removeAttribute(attr.name)
  }
  existing.replaceChildren(...incoming.childNodes)
}

function _readOverlayIdFromFetchEvent(event) {
  const detail = event.detail || {}
  const request = detail.fetchRequest || detail.request
  if (!request) return null
  const headers = (request.fetchOptions && request.fetchOptions.headers) ||
                  (typeof request.headers === "object" ? request.headers : null)
  if (!headers) return null
  return headers["X-Turbo-Overlay-Id"] || headers["x-turbo-overlay-id"] || null
}

function registerStreamAction() {
  if (typeof window === "undefined") return
  const Turbo = window.Turbo
  if (!Turbo || !Turbo.StreamActions || Turbo.StreamActions.overlay) return

  Turbo.StreamActions.overlay = function () {
    const message = this.getAttribute("message") || "close"
    const detail = {
      scope: this.getAttribute("scope") || "top",
      type: this.getAttribute("type") || null,
      id: this.getAttribute("overlay-id") || null
    }
    window.dispatchEvent(new CustomEvent(`turbo-overlay:${message}`, { detail }))
  }
}

// Drop the loading placeholder when:
//   - the matching server-rendered frame arrives in a turbo-stream
//   - the request errors out (network failure, 4xx/5xx)
//   - the user navigates away while a request is in flight
function registerLoadingHook() {
  if (typeof document === "undefined") return
  if (window._turboOverlayLoadingHookRegistered) return
  window._turboOverlayLoadingHookRegistered = true

  document.addEventListener("turbo:before-stream-render", (event) => {
    const stream = event.detail && event.detail.newStream
    if (!stream || !stream.templateElement) return
    const incomingFrames = stream.templateElement.content.querySelectorAll(
      "turbo-frame[id^='turbo_overlay_']"
    )
    incomingFrames.forEach((incomingFrame) => {
      const rest = incomingFrame.id.substring("turbo_overlay_".length)
      const underscore = rest.indexOf("_")
      if (underscore < 0) return
      const id = rest.substring(underscore + 1)

      if (dismissedLoadingIds.has(id)) {
        dismissedLoadingIds.delete(id)
        incomingFrame.remove()
        return
      }

      const placeholderFrame = findLoadingFrame(id)
      if (!placeholderFrame) return

      const incomingDialog    = incomingFrame.querySelector("dialog.turbo-overlay")
      const placeholderDialog = placeholderFrame.querySelector("dialog.turbo-overlay")
      if (!incomingDialog || !placeholderDialog) {
        removeLoadingOverlay(id)
        return
      }

      morphDialogInPlace(placeholderDialog, incomingDialog)
      delete placeholderFrame.dataset.turboOverlayLoadingId
      delete placeholderFrame.dataset.turboOverlayLoadingType
      inflightAborts.delete(id)

      incomingFrame.remove()
    })
  })

  document.addEventListener("turbo:fetch-request-error", (event) => {
    const id = _readOverlayIdFromFetchEvent(event)
    if (id) {
      removeLoadingOverlay(id)
      clearAdvanceUrl(id)
    }
  })

  document.addEventListener("turbo:before-fetch-response", (event) => {
    const id = _readOverlayIdFromFetchEvent(event)
    if (!id) return
    const response = event.detail && event.detail.fetchResponse
    if (response && response.succeeded) return
    removeLoadingOverlay(id)
    clearAdvanceUrl(id)
  })

  // `turbo:before-visit` fires only for proposed visits (link clicks,
  // form submits, programmatic `Turbo.visit`). Popstate-triggered
  // restoration visits go through `Navigator#startVisit` directly and
  // skip `before-visit` entirely. Use it to set the "real visit"
  // flag, which `before-cache` reads to decide whether to tear down.
  document.addEventListener("turbo:before-visit", () => {
    _realVisitInProgress = true
  })

  // `turbo:visit` fires for every visit (including restores). Handle
  // both responsibilities in a single listener so they run in the
  // right order against shared state:
  //
  //   1. Detect a restore visit triggered by Turbo Drive's popstate
  //      handler over an advance-pushed overlay (either one the gem
  //      just rolled back via `history.back()` on close, or a user
  //      browser-back over the gem's pushed URL) and cancel it.
  //      Otherwise Turbo loads the cached snapshot for the popped
  //      URL — replacing the page underneath and tearing down every
  //      open overlay in the process. Visit cancellation aborts the
  //      queued requestAnimationFrame inside `Visit#render` before
  //      it fires `cacheSnapshot()` → `before-cache`, so no teardown
  //      side effects.
  //
  //   2. For non-overlay visits, run the existing cleanup
  //      (`clearAllLoadingOverlays`, `popoverTriggers.clear`,
  //      `resetHistoryState`) AND mark the visit as real so
  //      `before-cache` runs the teardown.
  //
  // The cancel branch must come first: `resetHistoryState` clears
  // `pushedEntries`, which `hasPushedOverlayOnStack` reads, so
  // running it before the check would always observe an empty Map.
  document.addEventListener("turbo:visit", (event) => {
    const action = event.detail && event.detail.action

    if (action === "restore" &&
        (expectedPopstateCount() > 0 || hasPushedOverlayOnStack())) {
      // Turbo exposes the navigator at `window.Turbo.navigator`
      // (flat, not under session). `currentVisit` is set inside
      // `Navigator#startVisit` before `turbo:visit` dispatches.
      const visit = window.Turbo && window.Turbo.navigator && window.Turbo.navigator.currentVisit
      if (visit && typeof visit.cancel === "function") {
        try { visit.cancel() } catch (_) { /* ignore */ }
      }
      return
    }

    clearAllLoadingOverlays()
    popoverTriggers.clear()
    resetHistoryState()
    _realVisitInProgress = true
  })

  // `turbo:before-cache` fires in two distinct paths:
  //
  //   1. A real Turbo visit (link click, form submit, programmatic
  //      `Turbo.visit`, or a Turbo Drive restoration). The visit
  //      caches the current snapshot before navigating away — we
  //      want to tear down here so the cached snapshot doesn't
  //      contain stale `<dialog open>` elements.
  //
  //   2. Turbo Drive's `historyPoppedWithEmptyState` path. When a
  //      popstate fires for an entry that lacks `state.turbo` (e.g.
  //      one the gem pushed for an advance overlay), Turbo's
  //      `Session#historyPoppedWithEmptyState` calls
  //      `view.cacheSnapshot()` synchronously — which fires
  //      `before-cache` but does NOT start a visit. Tearing down here
  //      would close every open overlay on every overlay-related
  //      popstate.
  //
  // `_realVisitInProgress` is set above for path (1). Skipping the
  // teardown when the flag is false preserves overlays for path (2).
  document.addEventListener("turbo:before-cache", () => {
    if (!_realVisitInProgress) return
    _realVisitInProgress = false
    tearDownAllOverlays()
  })
}

function registerFetchHook() {
  if (typeof document === "undefined") return
  if (window._turboOverlayFetchHookRegistered) return
  window._turboOverlayFetchHookRegistered = true

  // For navigation visits (data-turbo-stream="true" GET links),
  // turbo:before-fetch-request's event.target is documentElement, not
  // the clicked link. Capture the link on its click event and read it
  // back when the fetch is about to fly.
  let pendingTrigger = null

  // Mirror Turbo's own clickEventIsSignificant predicate. For
  // data-turbo-stream links (what modal_link_to / drawer_link_to
  // produce) Turbo routes through FormLinkClickObserver and never
  // fires turbo:click, so we can't hook that. We instead capture on
  // plain click and skip clicks Turbo itself wouldn't intercept —
  // modifier keys, middle button, contenteditable. Without this skip,
  // a cmd+click (which opens in a new tab and never produces a fetch
  // in this tab) would leave pendingTrigger stale and leak the
  // X-Turbo-Overlay header onto the next unrelated fetch.
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return
    if (event.button !== 0) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.target && event.target.isContentEditable) return
    const link = event.target && event.target.closest
      ? event.target.closest("a[data-turbo-overlay], [data-turbo-overlay]")
      : null
    if (!link) return

    if (!link.dataset.turboOverlayId) {
      link.dataset.turboOverlayId = generateOverlayId()
    }
    if (link.dataset.turboOverlay === "popover") {
      // Stash the click coordinates on the element so the popover
      // positioner can disambiguate which line of a wrapped inline
      // trigger to anchor to. `getBoundingClientRect()` on a multi-line
      // anchor returns the union of all line boxes, which is too wide
      // to position against meaningfully.
      link.__turboOverlayClickPoint = { x: event.clientX, y: event.clientY }
      popoverTriggers.set(link.dataset.turboOverlayId, link)
    }

    const adv = resolveAdvanceUrl(link)
    if (adv) setAdvanceUrl(link.dataset.turboOverlayId, adv)

    pendingTrigger = link
  }, true)

  document.addEventListener("submit", (event) => {
    const form = event.target && event.target.closest
      ? event.target.closest("form[data-turbo-overlay]")
      : null
    if (form) pendingTrigger = form
  }, true)

  document.addEventListener("turbo:before-fetch-request", (event) => {
    let trigger = event.target && event.target.dataset && event.target.dataset.turboOverlay
      ? event.target
      : null
    if (!trigger && pendingTrigger) trigger = pendingTrigger
    pendingTrigger = null

    if (!trigger || !trigger.dataset || !trigger.dataset.turboOverlay) return

    const headers = event.detail.fetchOptions.headers
    headers["X-Turbo-Overlay"] = trigger.dataset.turboOverlay
    if (trigger.dataset.turboOverlayId) {
      headers["X-Turbo-Overlay-Id"] = trigger.dataset.turboOverlayId
    }
    if (trigger.dataset.turboOverlayPosition) {
      headers["X-Turbo-Overlay-Position"] = trigger.dataset.turboOverlayPosition
    }
    if (trigger.dataset.turboOverlayAlign) {
      headers["X-Turbo-Overlay-Align"] = trigger.dataset.turboOverlayAlign
    }
    if (trigger.dataset.turboOverlayOffset) {
      headers["X-Turbo-Overlay-Offset"] = trigger.dataset.turboOverlayOffset
    }
    if (trigger.dataset.turboOverlayBackdrop === "false") {
      headers["X-Turbo-Overlay-Backdrop"] = "false"
    }
    if (trigger.dataset.turboOverlayClose === "false") {
      headers["X-Turbo-Overlay-Close"] = "false"
    }

    // Sticky `data-turbo-overlay-id` on the trigger means a re-click
    // (or a re-submit) reuses the previous overlay id. If the previous
    // overlay is still in the DOM (popover still open, or a prior load
    // still in flight), spawning a new placeholder for this fetch
    // would produce two `<turbo-frame>` nodes with the same id; the
    // new controller's connect() would then take the "frame re-render"
    // branch and orphan the prior controller (no ESC, no
    // outside-click). Tear the existing frame down here — before the
    // new fetch's AbortController is registered — so any old in-flight
    // load is aborted via `inflightAborts.get(id)` while it still
    // holds the prior aborter.
    const overlayId   = trigger.dataset.turboOverlayId
    const overlayType = trigger.dataset.turboOverlay
    if (overlayId && overlayType) {
      const existing = document.getElementById(`turbo_overlay_${overlayType}_${overlayId}`)
      if (existing) {
        teardownExistingOverlayFrame(existing, overlayId)
        if (overlayType === "popover") popoverTriggers.set(overlayId, trigger)
      }
    }

    if (overlayId) {
      dismissedLoadingIds.delete(overlayId)
      if (typeof AbortController === "function") {
        const aborter = new AbortController()
        event.detail.fetchOptions.signal = aborter.signal
        inflightAborts.set(overlayId, aborter)
      }
    }

    spawnLoadingOverlay(trigger)
  })
}

// Replaces window.confirm for `data-turbo-confirm` links/forms with
// the gem's themed overlay. Opt-in via
// `register(application, { confirm: true })`.
//
// Two styles are supported via the per-variant templates
// `<template id="turbo_overlay_confirm_modal_template">` and
// `<template id="turbo_overlay_confirm_popover_template">` rendered by
// `overlay_stack_tag` from the host app's `_confirm.html+modal.erb`
// and `_confirm.html+popover.erb` partials.
//
// Style resolution (per call):
//   1. submitter element's `data-turbo-confirm-style`
//   2. form element's `data-turbo-confirm-style`
//   3. stack container's `data-turbo-overlay-confirm-style` (configured
//      default — `TurboOverlay.configuration.confirm.style`)
//   4. fallback "modal"
//
// Popover style needs a submitter element to anchor to. If the call
// doesn't carry one (programmatic form submission), we fall back to
// modal silently. We also fall back to modal if only the modal
// template was generated, and vice versa.
//
// If neither template is in the DOM (host app hasn't run install yet),
// we fall back to the browser-native `window.confirm`.

// Captured click trigger for the most recent `[data-turbo-confirm]`
// element the user clicked. Turbo's link-method path
// (`<a data-turbo-method="delete" data-turbo-confirm="…">`) synthesizes
// a hidden form and submits it without a submitter argument, so the
// confirm hook receives `submitter = null` and popover-style anchoring
// has nothing to attach to. Tracking the actual clicked element here
// lets `promptConfirm` recover the anchor when Turbo loses it.
let lastConfirmTrigger = null

export function registerConfirm() {
  if (typeof window === "undefined") return
  const Turbo = window.Turbo
  if (!Turbo || !Turbo.config || !Turbo.config.forms) return
  if (window._turboOverlayConfirmRegistered) return
  window._turboOverlayConfirmRegistered = true

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return
    if (event.button !== 0) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const trigger = event.target && event.target.closest
      ? event.target.closest("[data-turbo-confirm]")
      : null
    lastConfirmTrigger = trigger ? { element: trigger, at: Date.now() } : null
  }, true)

  Turbo.config.forms.confirm = (message, formElement, submitter) =>
    promptConfirm(message, formElement, submitter)
}

// Recover the clicked trigger when Turbo's submitter is null. Turbo's
// link-method path synthesizes a hidden form that bears no DOM
// relationship to the clicked link (it's appended directly to <body>),
// so we can't validate by containment. The freshness window is the
// safety net: confirm submissions are sequential — Turbo `await`s the
// hook — so an unrelated click can't slip in between the capture and
// the confirm callback in practice.
function recoverConfirmTrigger() {
  if (!lastConfirmTrigger) return null
  if (Date.now() - lastConfirmTrigger.at > 2000) return null
  const el = lastConfirmTrigger.element
  if (!el || !el.isConnected) return null
  return el
}

function resolveConfirmStyle(formElement, submitter, recoveredTrigger) {
  const explicit = (el) => el && el.dataset && el.dataset.turboConfirmStyle
  const fromTrigger = explicit(submitter) || explicit(recoveredTrigger) || explicit(formElement)
  if (fromTrigger === "modal" || fromTrigger === "popover") return fromTrigger

  const stack = document.querySelector("[data-controller~='turbo-overlay-stack']")
  const fromStack = stack && stack.dataset.turboOverlayConfirmStyle
  return fromStack === "popover" ? "popover" : "modal"
}

function findConfirmTemplate(preferredStyle) {
  const preferred = document.getElementById(`turbo_overlay_confirm_${preferredStyle}_template`)
  if (preferred) return { template: preferred, style: preferredStyle }
  const fallbackStyle = preferredStyle === "popover" ? "modal" : "popover"
  const fallback = document.getElementById(`turbo_overlay_confirm_${fallbackStyle}_template`)
  if (fallback) return { template: fallback, style: fallbackStyle }
  return null
}

function promptConfirm(message, formElement, submitter) {
  const recovered = submitter ? null : recoverConfirmTrigger()
  const anchor = submitter || recovered

  const requestedStyle = resolveConfirmStyle(formElement, submitter, recovered)
  const targetStyle = (requestedStyle === "popover" && anchor) ? "popover" : "modal"

  const found = findConfirmTemplate(targetStyle)
  const stack = document.querySelector("[data-controller~='turbo-overlay-stack']")
  const dialog = found && found.template.content && found.template.content.querySelector("dialog")
  if (!found || !stack || !dialog) {
    return Promise.resolve(window.confirm(message))
  }

  const style = found.style
  const clone = dialog.cloneNode(true)
  const id = "confirm-" + Math.random().toString(36).slice(2, 10)
  clone.setAttribute("data-turbo-overlay-id-value", id)

  const titlePrefix = style === "popover" ? "turbo-popover-title-" : "turbo-modal-title-"
  clone.setAttribute("aria-labelledby", titlePrefix + id)
  const title = clone.querySelector(`[id^='${titlePrefix}']`)
  if (title) title.id = titlePrefix + id

  if (style === "popover" && anchor) {
    popoverTriggers.set(id, anchor)
  }

  const messageEl = clone.querySelector("[data-turbo-overlay-confirm-message]")
  if (messageEl) messageEl.textContent = message

  const frame = document.createElement("turbo-frame")
  frame.id = `turbo_overlay_${style}_${id}`
  frame.className = "turbo-overlay-frame"
  frame.appendChild(clone)

  return new Promise((resolve) => {
    let settled = false
    const settleOnly = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const dismiss = (value) => {
      const dispatchClose = !settled
      settleOnly(value)
      if (dispatchClose) {
        window.dispatchEvent(new CustomEvent("turbo-overlay:close", { detail: { id } }))
      }
    }

    const accept = clone.querySelector("[data-turbo-overlay-confirm-accept]")
    const cancel = clone.querySelector("[data-turbo-overlay-confirm-cancel]")
    if (accept) accept.addEventListener("click", (e) => { e.preventDefault(); dismiss(true) })
    if (cancel) cancel.addEventListener("click", (e) => { e.preventDefault(); dismiss(false) })
    clone.addEventListener("cancel", () => settleOnly(false))
    clone.addEventListener("close",  () => settleOnly(false))

    stack.appendChild(frame)
  })
}

// Morph re-renders (form validation failure inside an open overlay)
// preserve dialog node identity so the overlay never closes/reopens.
// Idiomorph by default removes attributes not present in the incoming
// HTML — that's correct for normal markup but lethal for two
// attributes the gem's JS owns on overlay dialogs:
//
//   - `open`  — drives top-layer membership. The chrome partial never
//               emits it (showModal()/showPopover()/show() set it at
//               runtime), so a naive morph would strip it and the
//               overlay would close mid-edit.
//   - `style` — popover positioning is computed in JS and written as
//               inline styles. The chrome partial doesn't emit a
//               style attribute, so a naive morph would erase the
//               anchor coordinates and the popover would jump back
//               to its UA-default position.
//
// Block both attribute mutations on overlay dialogs. Everything else
// (data-* values, class, children) morphs normally so the form
// re-render shows error messages, repopulated fields, etc.
function registerMorphPreservationHook() {
  if (typeof document === "undefined") return
  if (window._turboOverlayMorphHookRegistered) return
  window._turboOverlayMorphHookRegistered = true

  document.addEventListener("turbo:before-morph-attribute", (event) => {
    const target = event.target
    if (!target || !target.classList) return
    if (target.tagName !== "DIALOG") return
    if (!target.classList.contains("turbo-overlay")) return
    const attributeName = event.detail && event.detail.attributeName
    if (attributeName === "open" || attributeName === "style") {
      event.preventDefault()
    }
  })
}

registerStreamAction()
registerFetchHook()
registerLoadingHook()
registerMorphPreservationHook()
registerPopstateHandler()
