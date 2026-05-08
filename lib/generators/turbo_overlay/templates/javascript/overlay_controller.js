import { Controller } from "@hotwired/stimulus"

// Per-overlay controller for turbo_overlay. Drives a native
// <dialog> regardless of theme — themes contribute markup and CSS
// only. Registers with the stack controller, opens the dialog, and
// runs an exit animation before tearing the frame down on close.
//
// Animation hooks (CSS in the layout supplies the keyframes):
//   - On open: the layout's `dialog[open]` rule animates entry.
//   - On close: this controller adds a `turbo-overlay-closing`
//     class, waits for `animationend` (or a 400ms safety timeout),
//     then calls `dialog.close()` and removes the frame.
//
// Respects `prefers-reduced-motion: reduce` by skipping the close
// animation wait.

const CLOSING_CLASS = "turbo-overlay-closing"
const CLOSE_ANIMATION_TIMEOUT_MS = 400

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
    if (this.stack) this.stack.unregister(this.idValue)
    this._animatedClose()
  }

  // data-action="cancel->turbo-overlay#cancel" — native dialog ESC.
  // Prevent the immediate close so we can animate; stop propagation
  // so ESC doesn't bubble to the dialog beneath in the stack.
  cancel(event) {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    if (this.stack) this.stack.unregister(this.idValue)
    this._animatedClose()
  }

  _animatedClose() {
    if (!this.dialog) {
      this._removeFrame()
      return
    }

    const reduced = typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (reduced) {
      this._finalizeClose()
      return
    }

    const target = this.element

    // Cancel any in-flight animations on this dialog (e.g. an open
    // animation that hasn't finished) so the closing animation
    // starts from a clean state. Without this, browsers sometimes
    // keep the prior animation in a "completed" state and don't
    // restart with the new CSS rule when the closing class is
    // added — visible as the second/third overlay in a stack
    // closing without animation.
    if (typeof target.getAnimations === "function") {
      target.getAnimations({ subtree: true }).forEach((a) => {
        try { a.cancel() } catch (_) {}
      })
    }

    target.classList.add(CLOSING_CLASS)

    let done = false
    const finish = () => {
      if (done) return
      done = true
      this._finalizeClose()
    }

    if (typeof target.getAnimations === "function") {
      // Force style/layout so the new CSS animation is registered
      // before we collect the Animation objects.
      void target.offsetWidth

      const animations = target.getAnimations({ subtree: true })
      if (animations.length === 0) {
        finish()
        return
      }
      Promise.allSettled(animations.map((a) => a.finished)).then(finish)
    }

    // Safety net: if no animation actually runs (CSS missing,
    // browser without WAAPI, etc.), still finalize after a bounded
    // wait so the dialog never gets stuck.
    setTimeout(finish, CLOSE_ANIMATION_TIMEOUT_MS)
  }

  _finalizeClose() {
    if (this.dialog && this.dialog.open) {
      try { this.dialog.close() } catch (_) { this.dialog.removeAttribute("open") }
    }
    this._removeFrame()
  }

  _removeFrame() {
    const frame = this.element.closest("turbo-frame.turbo-overlay-frame")
    if (frame && frame.parentNode) frame.remove()
    else if (this.element.parentNode) this.element.remove()
  }

  _findStack() {
    if (typeof document === "undefined") return null
    const stackEl = document.querySelector("[data-controller~='turbo-overlay-stack']")
    if (!stackEl || !this.application) return null
    return this.application.getControllerForElementAndIdentifier(stackEl, "turbo-overlay-stack")
  }
}
