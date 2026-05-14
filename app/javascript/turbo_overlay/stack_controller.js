import { Controller } from "@hotwired/stimulus"
import { getPopoverTrigger, clearPopoverTrigger } from "turbo_overlay/setup"
import { setStackController } from "turbo_overlay/history"

// Per-page stack registry. Mounted once on the host page via
// `<%= overlay_stack_tag %>` (DOM id `turbo_overlay_stack`). Tracks the
// order of currently-open overlays and routes server-issued
// `turbo_stream.overlay(:close, …)` events to the matching overlay's
// controller.
//
// Cross-cutting wiring (request-header injection, loading
// placeholders, back/forward cache teardown, themed confirm) lives in
// `turbo_overlay/setup`, which self-bootstraps on import from
// `turbo_overlay` (the gem's entry point).

export default class extends Controller {
  static values = {
    allowedClickOutsideSelectors: { type: Array, default: [] }
  }

  connect() {
    this.entries = []

    this._closeHandler = (event) => this.handleCloseEvent(event)
    window.addEventListener("turbo-overlay:close", this._closeHandler)

    setStackController(this)
  }

  disconnect() {
    window.removeEventListener("turbo-overlay:close", this._closeHandler)
    this.entries = []
    setStackController(null)
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
    // Only clear the popover-trigger registry when we actually removed
    // the entry. The disconnect path schedules a deferred unregister
    // via queueMicrotask as a safety net for elements ripped out of
    // the DOM without a close() — if close() already ran (and cleared
    // the entry), that deferred call must not clobber a popoverTriggers
    // entry that meanwhile has been re-pointed at a new overlay
    // reusing the same id (e.g. a re-click on the same popover_link_to).
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

    const closes = []
    if (id) {
      const entry = this.entries.find((e) => e.id === id)
      if (entry && entry.controller && typeof entry.controller.close === "function") {
        closes.push(entry.controller.close())
      }
    } else if (scope === "all") {
      const targets = type
        ? this.entries.filter((e) => e.type === type)
        : this.entries.slice()
      for (let i = targets.length - 1; i >= 0; i--) {
        const c = targets[i].controller
        if (c && typeof c.close === "function") closes.push(c.close())
      }
    } else {
      const top = this.topEntry(type)
      if (top && top.controller && typeof top.controller.close === "function") {
        closes.push(top.controller.close())
      }
    }

    // Server-requested post-close navigation. Await the close
    // animation(s) so the new page doesn't paint behind a
    // still-animating overlay. The visit defaults to "advance" — pass
    // visit_action: :replace from the server when you want the
    // current history entry rewritten (e.g., a stale URL the user
    // shouldn't be able to back into).
    if (detail.visit && typeof window !== "undefined" && window.Turbo &&
        typeof window.Turbo.visit === "function") {
      Promise.all(closes).then(() => {
        window.Turbo.visit(detail.visit, { action: detail.visitAction || "advance" })
      })
    }
  }
}
