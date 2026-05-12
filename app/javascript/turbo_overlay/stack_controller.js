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

export function getPopoverTrigger(id) {
  return popoverTriggers.get(id) || null
}

export function clearPopoverTrigger(id) {
  popoverTriggers.delete(id)
}

function generateOverlayId() {
  return "ov-" + Math.random().toString(36).slice(2, 10)
}

// Clone the matching `turbo_overlay_loading_<type>_template` into the
// stack and open it immediately. Inherits the trigger's link options
// (backdrop, drawer position, close button suppression, popover
// position/align/offset) so the placeholder reads visually the same
// as the eventual chrome. Tagged with `data-turbo-overlay-loading-id`
// matching the X-Turbo-Overlay-Id header so the loading element can
// be removed when the real frame lands or the request errors out.
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

  root.dataset.turboOverlayLoadingId = id
  root.dataset.turboOverlayLoadingType = type

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

  stack.appendChild(root)

  if (root.tagName === "DIALOG") {
    const useModal = (type === "modal") || (type === "drawer" && backdrop)
    try {
      if (useModal) root.showModal(); else root.show()
    } catch (_) {
      root.setAttribute("open", "")
    }
  }

  if (type === "popover") {
    positionLoadingPopover(root, link)
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

function removeLoadingOverlay(id) {
  if (!id) return
  const escaped = (window.CSS && typeof window.CSS.escape === "function")
    ? window.CSS.escape(id)
    : String(id).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
  const el = document.querySelector(`[data-turbo-overlay-loading-id="${escaped}"]`)
  if (!el) return
  if (el.tagName === "DIALOG" && el.open) {
    try { el.close() } catch (_) { /* ignore */ }
  }
  el.remove()
}

function clearAllLoadingOverlays() {
  const all = document.querySelectorAll("[data-turbo-overlay-loading-id]")
  all.forEach((el) => {
    if (el.tagName === "DIALOG" && el.open) {
      try { el.close() } catch (_) { /* ignore */ }
    }
    el.remove()
  })
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
    const frames = stream.templateElement.content.querySelectorAll(
      "turbo-frame[id^='turbo_overlay_']"
    )
    frames.forEach((frame) => {
      const rest = frame.id.substring("turbo_overlay_".length)
      const underscore = rest.indexOf("_")
      if (underscore < 0) return
      removeLoadingOverlay(rest.substring(underscore + 1))
    })
  })

  document.addEventListener("turbo:fetch-request-error", (event) => {
    const id = _readOverlayIdFromFetchEvent(event)
    if (id) removeLoadingOverlay(id)
  })

  document.addEventListener("turbo:before-fetch-response", (event) => {
    const response = event.detail && event.detail.fetchResponse
    if (!response || response.succeeded) return
    const id = _readOverlayIdFromFetchEvent(event)
    if (id) removeLoadingOverlay(id)
  })

  document.addEventListener("turbo:visit", () => {
    clearAllLoadingOverlays()
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
export function registerConfirm() {
  if (typeof window === "undefined") return
  const Turbo = window.Turbo
  if (!Turbo || !Turbo.config || !Turbo.config.forms) return
  if (window._turboOverlayConfirmRegistered) return
  window._turboOverlayConfirmRegistered = true

  Turbo.config.forms.confirm = (message, formElement, submitter) =>
    promptConfirm(message, formElement, submitter)
}

function resolveConfirmStyle(formElement, submitter) {
  const explicit = (el) => el && el.dataset && el.dataset.turboConfirmStyle
  const fromTrigger = explicit(submitter) || explicit(formElement)
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
  const requestedStyle = resolveConfirmStyle(formElement, submitter)
  // Popover style requires an anchor element. Without one, demote to modal.
  const targetStyle = (requestedStyle === "popover" && submitter) ? "popover" : "modal"

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

  // Popover variants need an anchor reference. The submitter element
  // is the natural anchor (the clicked button/link with data-turbo-confirm).
  if (style === "popover" && submitter) {
    popoverTriggers.set(id, submitter)
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
    this.entries = this.entries.filter((e) => e.id !== id)
    clearPopoverTrigger(id)
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
