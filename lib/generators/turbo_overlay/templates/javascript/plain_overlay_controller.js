import { Controller } from "@hotwired/stimulus"

// Per-dialog controller for native <dialog> overlays.
//
// One instance per open overlay. Registers with the stack controller
// on connect, opens the dialog, and removes the enclosing
// turbo-frame from the DOM on close.

export default class extends Controller {
  static values = {
    id: String,
    type: String
  }

  connect() {
    this.stack = this._findStack()
    this.dialog = this.element.tagName === "DIALOG"
      ? this.element
      : this.element.querySelector("dialog")

    if (this.stack && this.stack.has(this.idValue)) {
      // Frame re-render: dialog is already open; just update reference.
      this.stack.updateController(this.idValue, this)
      return
    }

    const registered = this.stack
      ? this.stack.register({ id: this.idValue, type: this.typeValue, controller: this })
      : true

    if (registered && this.dialog && !this.dialog.open) {
      try { this.dialog.showModal() } catch (_) { this.dialog.setAttribute("open", "") }
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
    if (this.dialog && this.dialog.open) {
      try { this.dialog.close() } catch (_) { this.dialog.removeAttribute("open") }
    }
    if (this.stack) this.stack.unregister(this.idValue)
    this._removeFrame()
  }

  // data-action="cancel->turbo-overlay#cancel" — native dialog ESC.
  // Stop propagation so ESC doesn't bubble through to the dialog
  // beneath in the stack.
  cancel(event) {
    if (event) event.stopPropagation()
    if (this.stack) this.stack.unregister(this.idValue)
    this._removeFrame()
  }

  _removeFrame() {
    const frame = this.element.closest("turbo-frame.turbo-overlay-frame")
    if (frame && frame.parentNode) frame.remove()
  }

  _findStack() {
    if (typeof document === "undefined") return null
    const stackEl = document.querySelector("[data-controller~='turbo-overlay-stack']")
    if (!stackEl || !this.application) return null
    return this.application.getControllerForElementAndIdentifier(stackEl, "turbo-overlay-stack")
  }
}
