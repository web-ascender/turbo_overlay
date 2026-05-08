import { Controller } from "@hotwired/stimulus"

// Per-overlay controller for turbo_overlay. Drives a native
// <dialog> regardless of theme — themes contribute markup and CSS
// only. Registers with the stack controller, opens the dialog, and
// runs an exit animation before tearing the frame down on close.
//
// Animation hooks:
//   - On open: the gem's CSS uses `dialog[open]` rules to animate
//     entry (fade for modal, slide for drawer).
//   - On close: this controller drives the dialog body's exit
//     animation directly via Web Animations API and adds a
//     `turbo-overlay-closing` class so CSS can co-animate the
//     `::backdrop` pseudo-element. We wait for the WAAPI animation
//     to finish, then call `dialog.close()` and remove the frame.
//
// Why JS-driven rather than pure-CSS: with stacked overlays, browsers
// don't reliably restart a CSS-defined `animation` property when a
// class is added after the open animation has already completed —
// the second-and-later overlay in a stack would dismiss without
// animation. Driving the close via WAAPI sidesteps that and works
// the same for every overlay in the stack.
//
// Respects `prefers-reduced-motion: reduce` by skipping the close
// animation entirely.

const CLOSING_CLASS = "turbo-overlay-closing"
const CLOSE_ANIMATION_TIMEOUT_MS = 600
const MODAL_CLOSE_DURATION_MS = 150
const DRAWER_CLOSE_DURATION_MS = 300

const DRAWER_CLOSE_KEYFRAMES = {
  right:  [{ transform: "translateX(0)" },  { transform: "translateX(100%)" }],
  left:   [{ transform: "translateX(0)" },  { transform: "translateX(-100%)" }],
  top:    [{ transform: "translateY(0)" },  { transform: "translateY(-100%)" }],
  bottom: [{ transform: "translateY(0)" },  { transform: "translateY(100%)" }]
}

const MODAL_CLOSE_KEYFRAMES = [
  { opacity: 1, transform: "scale(1)" },
  { opacity: 0, transform: "scale(0.97)" }
]

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

    // Cancel any in-flight animations (e.g. an open animation that
    // hasn't finished) so the closing animation starts from a
    // predictable state.
    if (typeof target.getAnimations === "function") {
      target.getAnimations({ subtree: true }).forEach((a) => {
        try { a.cancel() } catch (_) {}
      })
    }

    // The closing class lets CSS animate the ::backdrop and gives
    // theme stylesheets a hook for any extra exit styling.
    target.classList.add(CLOSING_CLASS)

    let done = false
    const finish = () => {
      if (done) return
      done = true
      this._finalizeClose()
    }

    const { keyframes, duration } = this._closeAnimation()

    if (keyframes && typeof target.animate === "function") {
      try {
        const animation = target.animate(keyframes, {
          duration,
          easing: "ease-out",
          fill: "forwards"
        })
        animation.addEventListener("finish", finish)
        animation.addEventListener("cancel", finish)
      } catch (_) {
        // animate() can throw on some legacy paths — fall through
        // to the safety timeout below.
      }
    }

    // Safety net so the dialog can never get stuck visible.
    setTimeout(finish, CLOSE_ANIMATION_TIMEOUT_MS)
  }

  _closeAnimation() {
    const target = this.element
    if (this.typeValue === "drawer") {
      const position = ["right", "left", "top", "bottom"]
        .find((p) => target.classList.contains(`turbo-overlay--drawer-${p}`)) || "right"
      return {
        keyframes: DRAWER_CLOSE_KEYFRAMES[position],
        duration: DRAWER_CLOSE_DURATION_MS
      }
    }
    return {
      keyframes: MODAL_CLOSE_KEYFRAMES,
      duration: MODAL_CLOSE_DURATION_MS
    }
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
