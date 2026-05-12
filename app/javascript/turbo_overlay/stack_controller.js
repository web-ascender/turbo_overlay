import { Controller } from "@hotwired/stimulus"
import { computePopoverPosition } from "turbo_overlay/popover_position"

// Stack registry + cross-cutting wiring for turbo_overlay.
//
// Mounted once on the host page via `<%= overlay_stack_tag %>` (DOM
// id `turbo_overlay_stack`). Tracks the order of currently-open
// overlays, routes server-issued `turbo_stream.overlay(:close, …)`
// events, and adds the `X-Turbo-Overlay` / `X-Turbo-Overlay-Id`
// request headers when a `modal_link_to` / `drawer_link_to` is
// clicked.

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

// Module-scoped registry mapping a popover's overlay id to the
// element that triggered it. The dialog's controller looks up its
// anchor here on connect so the trigger reference never has to
// round-trip to the server.
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

export function getPopoverTrigger(id) {
  return popoverTriggers.get(id) || null
}

export function clearPopoverTrigger(id) {
  popoverTriggers.delete(id)
}

function generateOverlayId() {
  return "ov-" + Math.random().toString(36).slice(2, 10)
}

// Tear down a same-id overlay frame still in the DOM so a re-click
// on its trigger can spawn a fresh placeholder without colliding on
// the `turbo_overlay_<type>_<id>` frame id. Drives the registered
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
// position/align/offset) so the placeholder reads visually the same
// as the eventual chrome.
//
// The placeholder dialog is wrapped in a `<turbo-frame>` that matches
// the id the server will eventually render. When the real response
// arrives, `before-stream-render` morphs the new dialog's attributes
// and children INTO this same dialog node so the overlay never
// closes and re-opens — the entry animation only plays once, when
// the placeholder first appears.
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
    // Drawer position class: per-link override, falls back to the
    // CSS default (`turbo-overlay--drawer-right` baked into the
    // shipped partial). Only add when the link provided one, so the
    // partial's baked-in default keeps working.
    const position = link.dataset.turboOverlayPosition
    if (position) {
      // Strip any baseline position class the partial includes so the
      // override wins without specificity tricks.
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

  // Wrap the placeholder dialog in a turbo-frame whose id matches the
  // server-side frame id. The placeholder IS the frame's initial
  // content; on response we morph the new content over this same
  // dialog so the open animation never re-runs. The loading marker
  // lives on the frame so removal handlers tear down both layers.
  const frame = document.createElement("turbo-frame")
  frame.id = `turbo_overlay_${type}_${id}`
  frame.className = "turbo-overlay-frame"
  frame.dataset.turboOverlayLoadingId = id
  frame.dataset.turboOverlayLoadingType = type
  frame.appendChild(root)

  stack.appendChild(frame)

  if (root.tagName === "DIALOG") {
    const useModal = (type === "modal") || (type === "drawer" && backdrop)
    try {
      if (useModal) root.showModal(); else root.show()
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
    // Safety net: if abort somehow doesn't prevent the response,
    // before-stream-render will drop the matching frame.
    dismissedLoadingIds.add(id)

    if (dialog.tagName === "DIALOG" && dialog.open) {
      try { dialog.close() } catch (_) { /* ignore */ }
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

  root.style.position = "fixed"
  root.style.top      = `${top}px`
  root.style.left     = `${left}px`
  root.style.margin   = "0"
}

function cssEscape(value) {
  return (window.CSS && typeof window.CSS.escape === "function")
    ? window.CSS.escape(value)
    : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
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

      // User dismissed the placeholder mid-flight (and the abort
      // didn't beat the response). Drop the frame so nothing renders.
      if (dismissedLoadingIds.has(id)) {
        dismissedLoadingIds.delete(id)
        incomingFrame.remove()
        return
      }

      const placeholderFrame = findLoadingFrame(id)
      if (!placeholderFrame) return  // no loading shown; let stream render normally

      const incomingDialog    = incomingFrame.querySelector("dialog.turbo-overlay")
      const placeholderDialog = placeholderFrame.querySelector("dialog.turbo-overlay")
      if (!incomingDialog || !placeholderDialog) {
        // Unexpected payload — fall back to a plain swap.
        removeLoadingOverlay(id)
        return
      }

      // Morph in place: same dialog node, new attributes + content.
      // The dialog stays open the entire time, so no entry animation
      // re-runs and there's no visual gap.
      morphDialogInPlace(placeholderDialog, incomingDialog)
      delete placeholderFrame.dataset.turboOverlayLoadingId
      delete placeholderFrame.dataset.turboOverlayLoadingType
      inflightAborts.delete(id)

      // Frame is now the live frame; drop the incoming so the stream
      // append doesn't add a duplicate.
      incomingFrame.remove()
    })
  })

  document.addEventListener("turbo:fetch-request-error", (event) => {
    const id = _readOverlayIdFromFetchEvent(event)
    if (id) removeLoadingOverlay(id)
  })

  document.addEventListener("turbo:before-fetch-response", (event) => {
    const id = _readOverlayIdFromFetchEvent(event)
    if (!id) return
    // Successful responses are torn down in before-stream-render once
    // the new dialog has morphed in; here we only have to handle
    // failures so the placeholder doesn't get stuck on a 4xx/5xx.
    const response = event.detail && event.detail.fetchResponse
    if (response && response.succeeded) return
    removeLoadingOverlay(id)
  })

  document.addEventListener("turbo:visit", () => {
    clearAllLoadingOverlays()
    // Belt-and-suspenders for visits that skipped the before-cache hook
    // (cache-control: no-cache pages, the very first visit of a session,
    // or any path where Turbo decided not to snapshot). The before-cache
    // teardown is the primary cleanup; this just guarantees no stale
    // anchor reference survives the navigation regardless.
    popoverTriggers.clear()
  })

  // Tear overlays out of the DOM before Turbo snapshots the page so the
  // back/forward cache doesn't restore a dialog whose top-layer state
  // has been lost across navigations. Modal/drawer/popover state is
  // transient UI — not page content — so we drop it cleanly here and
  // let the user's next action re-open if needed.
  document.addEventListener("turbo:before-cache", () => {
    tearDownAllOverlays()
  })
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

function registerFetchHook() {
  if (typeof document === "undefined") return
  if (window._turboOverlayFetchHookRegistered) return
  window._turboOverlayFetchHookRegistered = true

  // For navigation visits (data-turbo-stream="true" GET links),
  // turbo:before-fetch-request's event.target is documentElement,
  // not the clicked link. Capture the link on its click event and
  // read it back when the fetch is about to fly.
  let pendingTrigger = null

  // Mirror Turbo's own clickEventIsSignificant predicate. For
  // data-turbo-stream links (what modal_link_to / drawer_link_to
  // produce) Turbo routes through FormLinkClickObserver and never
  // fires turbo:click, so we can't hook that. We instead capture on
  // plain click and skip clicks Turbo itself wouldn't intercept —
  // modifier keys, middle button, contenteditable. Without this
  // skip, a cmd+click (which opens in a new tab and never produces a
  // fetch in this tab) would leave pendingTrigger stale and leak the
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

    // Mint an overlay id client-side when the link didn't supply one.
    // Popovers need it for the trigger registry; every type needs it
    // so the loading-state element can be tagged with the same id the
    // server will use to render the real frame.
    if (!link.dataset.turboOverlayId) {
      link.dataset.turboOverlayId = generateOverlayId()
    }
    if (link.dataset.turboOverlay === "popover") {
      popoverTriggers.set(link.dataset.turboOverlayId, link)
    }

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
        // unregister() (driven by the close dispatch in teardown)
        // clears the popover trigger registry entry; restore it from
        // the current click so the new popover's _connectPopover can
        // find its anchor instead of falling back to centered.
        if (overlayType === "popover") popoverTriggers.set(overlayId, trigger)
      }
    }

    // Inject an AbortController so dismissing the loading placeholder
    // actually cancels the in-flight fetch instead of just discarding
    // the response. Turbo respects `fetchOptions.signal` when it
    // constructs the underlying fetch call. Clear any stale dismissal
    // for this id first — overlay ids are sticky on the trigger, so a
    // re-click reuses the id, and we must not let the dismissed-safety
    // -net set from a prior dismissal discard this fresh request's
    // response.
    if (overlayId) {
      dismissedLoadingIds.delete(overlayId)
      if (typeof AbortController === "function") {
        const aborter = new AbortController()
        event.detail.fetchOptions.signal = aborter.signal
        inflightAborts.set(overlayId, aborter)
      }
    }

    // Now that the request is actually in flight (past Turbo's
    // confirm prompt etc.), drop a loading placeholder into the stack.
    spawnLoadingOverlay(trigger)
  })
}

// Replaces window.confirm for `data-turbo-confirm` links/forms with
// the gem's themed overlay. Opt-in via `register(application, { confirm: true })`.
//
// Two styles are supported via the per-variant templates
// `<template id="turbo_overlay_confirm_modal_template">` and
// `<template id="turbo_overlay_confirm_popover_template">` rendered
// by `overlay_stack_tag` from the host app's `_confirm.html+modal.erb`
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

  // Capture-phase so we record the trigger before Turbo's own click
  // handler synthesizes the form and dispatches confirm.
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
  // Turbo's link-method path (`<a data-turbo-method data-turbo-confirm>`)
  // synthesizes a hidden form and calls confirm with `submitter = null`,
  // which would silently demote popover-style to modal. Fall back to the
  // element the user just clicked so the anchor reference survives.
  const recovered = submitter ? null : recoverConfirmTrigger()
  const anchor = submitter || recovered

  const requestedStyle = resolveConfirmStyle(formElement, submitter, recovered)
  // Popover style requires an anchor element. Without one, demote to modal.
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

  // Popover variants need an anchor reference. Prefer Turbo's submitter
  // (real form-button click); fall back to the click target we captured
  // for `<a data-turbo-method>` links where Turbo passes a null submitter.
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
    // ESC fires native `cancel` synchronously; resolve immediately so
    // Turbo doesn't wait on the close animation.
    clone.addEventListener("cancel", () => settleOnly(false))
    clone.addEventListener("close",  () => settleOnly(false))

    stack.appendChild(frame)
  })
}

registerStreamAction()
registerFetchHook()
registerLoadingHook()

export default class extends Controller {
  connect() {
    registerStreamAction()
    registerFetchHook()
    registerLoadingHook()
    this.entries = []

    this._closeHandler = (event) => this.handleCloseEvent(event)
    window.addEventListener("turbo-overlay:close", this._closeHandler)
  }

  disconnect() {
    window.removeEventListener("turbo-overlay:close", this._closeHandler)
    this.entries = []
  }

  register(entry) {
    if (this.entries.some((e) => e.id === entry.id)) return false

    // Single-popover behavior: opening a new popover closes any other
    // open popovers. Modals and drawers keep their existing stacking.
    if (entry.type === "popover") {
      const existing = this.entries.filter((e) => e.type === "popover")
      for (const prior of existing) {
        if (prior.controller && typeof prior.controller.close === "function") {
          prior.controller.close()
        }
      }
    }

    this.entries.push(entry)
    return true
  }

  unregister(id) {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    // Only clear the popover-trigger registry when we actually
    // removed the entry. The disconnect path schedules a deferred
    // unregister via queueMicrotask as a safety net for elements
    // ripped out of the DOM without a close() — if close() already
    // ran (and cleared the entry), that deferred call must not
    // clobber a popoverTriggers entry that meanwhile has been
    // re-pointed at a new overlay reusing the same id (e.g. a
    // re-click on the same popover_link_to).
    if (this.entries.length < before) clearPopoverTrigger(id)
  }

  getPopoverTrigger(id) {
    return getPopoverTrigger(id)
  }

  has(id) {
    return this.entries.some((e) => e.id === id)
  }

  updateController(id, controller) {
    const entry = this.entries.find((e) => e.id === id)
    if (entry) entry.controller = controller
  }

  get depth() {
    return this.entries.length
  }

  topEntry(typeFilter = null) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (!typeFilter || this.entries[i].type === typeFilter) return this.entries[i]
    }
    return null
  }

  handleCloseEvent(event) {
    const detail = event.detail || {}
    const scope = detail.scope || "top"
    const type = detail.type || null
    const id = detail.id || null

    if (id) {
      const entry = this.entries.find((e) => e.id === id)
      if (entry && entry.controller && typeof entry.controller.close === "function") {
        entry.controller.close()
      }
      return
    }

    if (scope === "all") {
      const targets = type
        ? this.entries.filter((e) => e.type === type)
        : this.entries.slice()
      for (let i = targets.length - 1; i >= 0; i--) {
        const c = targets[i].controller
        if (c && typeof c.close === "function") c.close()
      }
      return
    }

    const top = this.topEntry(type)
    if (top && top.controller && typeof top.controller.close === "function") {
      top.controller.close()
    }
  }
}
