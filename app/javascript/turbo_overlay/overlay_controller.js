import { Controller } from "@hotwired/stimulus"
import { computePopoverPosition } from "turbo_overlay/popover_position"

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
    backdropDismiss: { type: Boolean, default: true },
    position: { type: String, default: "" },
    align: { type: String, default: "" },
    offset: { type: Number, default: 4 }
  }

  connect() {
    this.stack = this._findStack()
    this.dialog = this.element.tagName === "DIALOG"
      ? this.element
      : this.element.querySelector("dialog")

    if (this.stack && this.stack.has(this.idValue)) {
      // Frame re-render: dialog is already open; just update reference.
      this.stack.updateController(this.idValue, this)
      if (this.typeValue === "popover") {
        this._targetLinksTop()
        this._positionPopover()
      }
      return
    }

    if (this.typeValue === "popover") {
      this._connectPopover()
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
        this._installEscHandler()
      }
    } else if (registered && this.dialog && this.dialog.open && !this.backdropValue) {
      // Non-modal path after a morph from loading: dialog is already
      // open in non-modal mode, but the ESC handler hasn't been
      // installed yet (the placeholder didn't have a controller).
      this._installEscHandler()
    }
  }

  disconnect() {
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler)
      this._escHandler = null
    }
    if (this._outsideClickHandler) {
      document.removeEventListener("mousedown", this._outsideClickHandler, true)
      this._outsideClickHandler = null
    }
    if (this._reflowHandler) {
      window.removeEventListener("scroll", this._reflowHandler, true)
      window.removeEventListener("resize", this._reflowHandler)
      this._reflowHandler = null
    }
    if (this._reflowFrame) {
      cancelAnimationFrame(this._reflowFrame)
      this._reflowFrame = null
    }
    queueMicrotask(() => {
      if (!document.body.contains(this.element) && this.stack) {
        this.stack.unregister(this.idValue)
      }
    })
  }

  _installEscHandler() {
    this._escHandler = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (this.stack && this.stack.topEntry() && this.stack.topEntry().id !== this.idValue) return
      event.preventDefault()
      this.cancel(event)
    }
    document.addEventListener("keydown", this._escHandler)
  }

  _connectPopover() {
    this.anchor = this.stack ? this.stack.getPopoverTrigger(this.idValue) : null

    const registered = this.stack
      ? this.stack.register({ id: this.idValue, type: this.typeValue, controller: this, anchor: this.anchor })
      : true
    if (!registered) return

    if (this.dialog && !this.dialog.open) {
      try { this.dialog.show() } catch (_) { this.dialog.setAttribute("open", "") }
    }

    this._targetLinksTop()
    this._positionPopover()

    this._installEscHandler()

    // Click-outside dismissal. Use mousedown capture so we fire
    // before any link inside the popover triggers its own navigation.
    this._outsideClickHandler = (event) => {
      if (!this.dialog) return
      const target = event.target
      if (this.dialog.contains(target)) return
      if (this.anchor && this.anchor.contains && this.anchor.contains(target)) return
      this.cancel(event)
    }
    document.addEventListener("mousedown", this._outsideClickHandler, true)

    // Reposition on scroll/resize so the popover tracks its anchor.
    this._reflowHandler = () => {
      if (this._reflowFrame) return
      this._reflowFrame = requestAnimationFrame(() => {
        this._reflowFrame = null
        this._positionPopover()
      })
    }
    window.addEventListener("scroll", this._reflowHandler, true)
    window.addEventListener("resize", this._reflowHandler)
  }

  // Inside a popover, a plain `link_to` would otherwise navigate
  // inside the popover's turbo-frame and replace the popover's
  // contents. Default such links to `_top`. Overlay-opening links
  // (modal/drawer/popover_link_to) already carry data-turbo-frame=_top
  // and data-turbo-overlay; skip them so they keep their stacking
  // behavior. Forms inside the popover are untouched so they can
  // still re-render in place on validation failure.
  _targetLinksTop() {
    if (!this.dialog) return
    const links = this.dialog.querySelectorAll(
      "a[href]:not([data-turbo-frame]):not([data-turbo-overlay])"
    )
    links.forEach((a) => { a.dataset.turboFrame = "_top" })
  }

  _positionPopover() {
    if (!this.dialog) return

    // No anchor (e.g. tests, page rehydration without trigger): fall
    // back to centered fixed positioning so the dialog is still visible.
    if (!this.anchor || typeof this.anchor.getBoundingClientRect !== "function") {
      this.dialog.style.position = "fixed"
      this.dialog.style.top = "50%"
      this.dialog.style.left = "50%"
      this.dialog.style.margin = "0"
      this.dialog.style.transform = "translate(-50%, -50%)"
      return
    }

    const anchorRect = this.anchor.getBoundingClientRect()
    const dialogRect = this.dialog.getBoundingClientRect()
    const viewport = {
      width:  document.documentElement.clientWidth,
      height: document.documentElement.clientHeight
    }

    const { top, left, resolvedPosition } = computePopoverPosition({
      anchor:   anchorRect,
      dialog:   dialogRect,
      viewport,
      position: this.positionValue || "bottom",
      align:    this.alignValue    || "start",
      offset:   this.offsetValue,
      autoFlip: true
    })

    this.dialog.style.position = "fixed"
    this.dialog.style.top  = `${top}px`
    this.dialog.style.left = `${left}px`
    this.dialog.style.margin = "0"
    this.dialog.style.transform = ""
    this.dialog.dataset.resolvedPosition = resolvedPosition
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
