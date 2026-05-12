import { Controller } from "@hotwired/stimulus"

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
    if (link) pendingTrigger = link
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
  })
}

// Replaces window.confirm for `data-turbo-confirm` links/forms with
// the gem's themed modal. Opt-in via `register(application, { confirm: true })`.
//
// On each invocation we clone `<template id="turbo_overlay_confirm_template">`
// (server-rendered by `overlay_stack_tag` from the host app's
// `app/views/turbo_overlay/_confirm.html.erb` partial), wire its
// accept/cancel buttons + ESC + backdrop to a Promise, generate a
// unique overlay id, and append it inside a `<turbo-frame>` to the
// stack container. The existing `turbo-overlay` controller handles
// `showModal()` + animations + stack registration on Stimulus connect.
//
// If the template element is missing (e.g. host app hasn't generated
// the partial yet, or has deleted it), we fall back to the
// browser-native `window.confirm` so the trigger still works.
export function registerConfirm() {
  if (typeof window === "undefined") return
  const Turbo = window.Turbo
  if (!Turbo || !Turbo.config || !Turbo.config.forms) return
  if (window._turboOverlayConfirmRegistered) return
  window._turboOverlayConfirmRegistered = true

  Turbo.config.forms.confirm = (message) => promptConfirm(message)
}

function promptConfirm(message) {
  const template = document.getElementById("turbo_overlay_confirm_template")
  const stack = document.querySelector("[data-controller~='turbo-overlay-stack']")
  const dialog = template && template.content && template.content.querySelector("dialog")
  if (!template || !stack || !dialog) {
    return Promise.resolve(window.confirm(message))
  }

  const clone = dialog.cloneNode(true)
  const id = "confirm-" + Math.random().toString(36).slice(2, 10)
  clone.setAttribute("data-turbo-overlay-id-value", id)
  clone.setAttribute("aria-labelledby", "turbo-modal-title-" + id)
  const title = clone.querySelector("[id^='turbo-modal-title-']")
  if (title) title.id = "turbo-modal-title-" + id

  const messageEl = clone.querySelector("[data-turbo-overlay-confirm-message]")
  if (messageEl) messageEl.textContent = message

  const frame = document.createElement("turbo-frame")
  frame.id = "turbo_overlay_modal_" + id
  frame.className = "turbo-overlay-frame"
  frame.appendChild(clone)

  return new Promise((resolve) => {
    let settled = false
    const settleOnly = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    // Button clicks need to also close the dialog (ESC and backdrop
    // click go through the existing turbo-overlay controller, which
    // closes the dialog itself).
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
    // Turbo doesn't wait on the close animation. Backdrop click closes
    // through the existing controller; its eventual `close` event is
    // our catch-all.
    clone.addEventListener("cancel", () => settleOnly(false))
    clone.addEventListener("close",  () => settleOnly(false))

    stack.appendChild(frame)
  })
}

registerStreamAction()
registerFetchHook()

export default class extends Controller {
  connect() {
    registerStreamAction()
    registerFetchHook()
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
    this.entries.push(entry)
    return true
  }

  unregister(id) {
    this.entries = this.entries.filter((e) => e.id !== id)
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
