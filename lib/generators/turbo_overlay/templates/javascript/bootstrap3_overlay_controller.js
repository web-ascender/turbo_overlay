import { Controller } from "@hotwired/stimulus"

// Per-overlay controller for Bootstrap 3 modals (no drawer in BS3).
// Requires jQuery + Bootstrap 3's modal plugin on `window.jQuery` /
// `window.$`.
//
// Supports stacking by manually bumping z-index based on stack
// depth.

export default class extends Controller {
  static values = {
    id: String,
    type: String
  }

  connect() {
    this.stack = this._findStack()

    if (this.stack && this.stack.has(this.idValue)) {
      this.stack.updateController(this.idValue, this)
      const jq = window.jQuery || window.$
      if (jq) this.$el = jq(this.element)
      return
    }

    const jq = window.jQuery || window.$
    if (!jq || typeof jq(this.element).modal !== "function") {
      console.warn("[turbo-overlay] jQuery + Bootstrap 3 modal plugin not found; overlay will not auto-open.")
      return
    }

    this.$el = jq(this.element)
    const registered = this.stack
      ? this.stack.register({ id: this.idValue, type: this.typeValue, controller: this })
      : true

    if (registered) {
      this._applyZIndex()
      this.$el.modal({ show: true })
    }
  }

  disconnect() {
    queueMicrotask(() => {
      if (!document.body.contains(this.element) && this.stack) {
        this.stack.unregister(this.idValue)
      }
    })
  }

  // data-action="click->turbo-overlay#close"
  close(event) {
    if (event) event.preventDefault()
    if (this.stack) this.stack.unregister(this.idValue)
    this._removeFrameAfterHide()
    if (this.$el) this.$el.modal("hide")
  }

  cancel(event) {
    if (event) event.stopPropagation()
    this.close()
  }

  _applyZIndex() {
    if (!this.stack) return
    const depth = this.stack.depth
    const z = 1050 + (depth - 1) * 20
    this.element.style.zIndex = String(z)
    queueMicrotask(() => {
      const backdrops = document.querySelectorAll(".modal-backdrop")
      const backdrop = backdrops[backdrops.length - 1]
      if (backdrop) backdrop.style.zIndex = String(z - 1)
    })
  }

  _removeFrameAfterHide() {
    if (!this.$el) return
    const frame = this.element.closest("turbo-frame.turbo-overlay-frame")
    if (!frame) return
    this.$el.one("hidden.bs.modal", () => {
      if (frame.parentNode) frame.remove()
    })
  }

  _findStack() {
    if (typeof document === "undefined") return null
    const stackEl = document.querySelector("[data-controller~='turbo-overlay-stack']")
    if (!stackEl || !this.application) return null
    return this.application.getControllerForElementAndIdentifier(stackEl, "turbo-overlay-stack")
  }
}
