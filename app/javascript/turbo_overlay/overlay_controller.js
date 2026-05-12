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
    type: String,
    backdrop: { type: Boolean, default: true },
    backdropDismiss: { type: Boolean, default: true }
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
      if (this.backdropValue) {
        try { this.dialog.showModal() } catch (_) { this.dialog.setAttribute("open", "") }
      } else {
        // Non-modal: page remains interactive (no backdrop, no focus
        // trap, scrollable). Native `cancel` doesn't fire on ESC for
        // non-modal dialogs, so synthesize it via keydown.
        try { this.dialog.show() } catch (_) { this.dialog.setAttribute("open", "") }
        this._escHandler = (event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return
          if (this.stack && this.stack.topEntry() && this.stack.topEntry().id !== this.idValue) return
          event.preventDefault()
          this.cancel(event)
        }
        document.addEventListener("keydown", this._escHandler)
      }
    }
  }

  disconnect() {
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler)
      this._escHandler = null
    }
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

  // data-action="click->turbo-overlay#backdropClick" — clicks on the
  // dialog's ::backdrop register with the dialog as event.target.
  // Children that bubble up have a different target and are ignored.
  // Opt out per-overlay with data-turbo-overlay-backdrop-dismiss-value="false".
  backdropClick(event) {
    if (!this.backdropDismissValue) return
    if (event.target !== this.dialog) return
    this.cancel(event)
  }

  _animatedClose() {
    if (!this.dialog) {
      this._removeFrame()
      return
    }

    const reduced = typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (reduced || !this.dialog.open) {
      this._finalizeClose()
      return
    }

    const target = this.element
    target.classList.add(CLOSING_CLASS)

    let done = false
    const finish = () => {
      if (done) return
      done = true
      target.removeEventListener("animationend", onEnd)
      this._finalizeClose()
    }
    const onEnd = (event) => {
      // Animations on inner elements may also fire; only finalize
      // when the dialog (or its ::backdrop) finishes.
      if (event.target !== target) return
      finish()
    }
    target.addEventListener("animationend", onEnd)
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
