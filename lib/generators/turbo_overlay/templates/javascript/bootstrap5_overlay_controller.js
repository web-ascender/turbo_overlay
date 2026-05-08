import { Controller } from "@hotwired/stimulus"

// Per-overlay controller for Bootstrap 5 modals and offcanvas
// drawers. Picks Modal vs Offcanvas based on the `type` value.
//
// `window.bootstrap` must be available (typically via
// `import * as bootstrap from "bootstrap"; window.bootstrap = bootstrap`).
//
// Supports stacking by manually bumping the BS5 z-index custom
// property based on stack depth — BS5 doesn't natively support
// stacked modals/offcanvas.

export default class extends Controller {
  static values = {
    id: String,
    type: String
  }

  connect() {
    this.stack = this._findStack()

    if (this.stack && this.stack.has(this.idValue)) {
      this.stack.updateController(this.idValue, this)
      this._rewireBsInstance()
      return
    }

    if (typeof window.bootstrap === "undefined") {
      console.warn("[turbo-overlay] Bootstrap 5 JS not found on window.bootstrap; overlay will not auto-open.")
      return
    }

    this._rewireBsInstance()
    if (!this.bs) return

    const registered = this.stack
      ? this.stack.register({ id: this.idValue, type: this.typeValue, controller: this })
      : true

    if (registered) {
      this._applyZIndex()
      this.bs.show()
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
    if (this.bs) this.bs.hide()
  }

  // BS5 modals call hide() on Esc internally; if a layout wires Esc
  // to this action, treat it as a close.
  cancel(event) {
    if (event) event.stopPropagation()
    this.close()
  }

  _rewireBsInstance() {
    if (typeof window.bootstrap === "undefined") return
    if (this.typeValue === "drawer") {
      this.bs = window.bootstrap.Offcanvas.getOrCreateInstance(this.element)
    } else {
      this.bs = window.bootstrap.Modal.getOrCreateInstance(this.element)
    }
  }

  _applyZIndex() {
    if (!this.stack) return
    const depth = this.stack.depth
    const isDrawer = this.typeValue === "drawer"
    const base = isDrawer ? 1045 : 1055
    const step = 20
    const z = base + (depth - 1) * step
    this.element.style.setProperty(
      `--bs-${isDrawer ? "offcanvas" : "modal"}-zindex`,
      String(z)
    )
    queueMicrotask(() => {
      const backdropClass = isDrawer ? ".offcanvas-backdrop" : ".modal-backdrop"
      const backdrops = document.querySelectorAll(backdropClass)
      const backdrop = backdrops[backdrops.length - 1]
      if (backdrop) backdrop.style.zIndex = String(z - 1)
    })
  }

  _removeFrameAfterHide() {
    const frame = this.element.closest("turbo-frame.turbo-overlay-frame")
    if (!frame) return
    const onHidden = () => {
      this.element.removeEventListener("hidden.bs.modal", onHidden)
      this.element.removeEventListener("hidden.bs.offcanvas", onHidden)
      if (frame.parentNode) frame.remove()
    }
    this.element.addEventListener("hidden.bs.modal", onHidden, { once: true })
    this.element.addEventListener("hidden.bs.offcanvas", onHidden, { once: true })
  }

  _findStack() {
    if (typeof document === "undefined") return null
    const stackEl = document.querySelector("[data-controller~='turbo-overlay-stack']")
    if (!stackEl || !this.application) return null
    return this.application.getControllerForElementAndIdentifier(stackEl, "turbo-overlay-stack")
  }
}
