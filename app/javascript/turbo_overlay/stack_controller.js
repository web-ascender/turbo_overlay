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
