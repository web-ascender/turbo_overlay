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
      // Frame re-render — form submission inside an open overlay
      // (the most common case is a validation failure re-rendering
      // the form). Turbo's default frame replacement swaps the
      // `<dialog>` node entirely; the new dialog has no `open`
      // attribute and is detached from the top layer. Re-open it in
      // the same mode the original used so the overlay stays visible.
      this.stack.updateController(this.idValue, this)
      if (this.dialog && !this._isShown()) {
        if (this.backdropValue) {
          try { this.dialog.showModal() } catch (_) { this.dialog.setAttribute("open", "") }
        } else if (this.typeValue === "popover") {
          if (this._needsModalStacking()) {
            try { this.dialog.showModal() } catch (_) { this.dialog.setAttribute("open", "") }
          } else {
            try { this.dialog.showPopover() } catch (_) { this.dialog.setAttribute("open", "") }
          }
          this._installEscHandler()
        } else {
          try { this.dialog.show() } catch (_) { this.dialog.setAttribute("open", "") }
          this._installEscHandler()
        }
      }
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

    if (!registered) return

    if (this.dialog && !this.dialog.open) {
      if (this.backdropValue) {
        try { this.dialog.showModal() } catch (_) { this.dialog.setAttribute("open", "") }
      } else {
        // Non-modal: page remains interactive (no backdrop, no focus
        // trap, scrollable). Native `cancel` doesn't fire on ESC for
        // non-modal dialogs, so synthesize it via keydown.
        try { this.dialog.show() } catch (_) { this.dialog.setAttribute("open", "") }
        this._installEscHandler()
      }
    } else if (this.dialog && this.dialog.open && !this.backdropValue) {
      // Non-modal path after a morph from loading: dialog is already
      // open in non-modal mode, but the ESC handler hasn't been
      // installed yet (the placeholder didn't have a controller).
      this._installEscHandler()
    }

    this._dispatch("shown")
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

    if (this.dialog && !this._isShown()) {
      // See _popoverNeedsModal — popovers opened above an existing
      // modal dialog must themselves be modal, otherwise the HTML
      // inertness algorithm makes the popover unresponsive to clicks
      // even while it renders above the modal.
      if (this._needsModalStacking()) {
        try { this.dialog.showModal() } catch (_) { this.dialog.setAttribute("open", "") }
      } else {
        try { this.dialog.showPopover() } catch (_) { this.dialog.setAttribute("open", "") }
      }
    }

    this._targetLinksTop()
    this._positionPopover()
    // The dialog was just morphed in from a loading placeholder
    // (small spinner). The first _positionPopover above used whatever
    // the dialog measured immediately after Stimulus connected, which
    // can lag the actual content layout by a frame. Re-run on the
    // next animation frame so we measure against the final content
    // size and reposition (auto-flip) accordingly.
    requestAnimationFrame(() => {
      if (this.dialog && this._isShown()) this._positionPopover()
    })
    // The anchor may still be moving (e.g. opened a popover from
    // inside a drawer that's mid-slide-in). Re-position on subsequent
    // frames until the anchor's left edge stabilizes, with a safety
    // cap so animations longer than ~500ms don't pin the CPU.
    this._trackAnchorUntilSettled()

    this._installEscHandler()

    // Click-outside dismissal. Use mousedown capture so we fire
    // before any link inside the popover triggers its own navigation.
    // `target === dialog` catches clicks on the ::backdrop for the
    // showModal'd path (popovers inside a modal context); descendant
    // checks handle the showPopover'd path.
    this._outsideClickHandler = (event) => {
      if (!this.dialog) return
      const target = event.target
      if (target === this.dialog) { this.cancel(event); return }
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

    this._dispatch("shown")
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

  // When a modal dialog is already open, popovers added to the top
  // layer via `showPopover()` are still rendered above the modal but
  // become inert per the HTML inertness algorithm — only descendants
  // of the topmost modal dialog (or the modal itself) receive input.
  // Detect that case so the popover can use `showModal()` instead
  // and become the topmost modal itself; a transparent `::backdrop`
  // CSS rule preserves the non-modal visual feel.
  //
  // Non-modal drawers are intentionally NOT auto-promoted: the UA
  // `dialog:modal` stylesheet overrides the gem's drawer-position
  // inset rules and re-centers the drawer in the viewport. Opening a
  // non-modal drawer from inside a modal is documented as unsupported.
  //
  // The check excludes our own dialog: when called from the frame
  // re-render branch the popover may already be open via showModal()
  // and would otherwise match `:modal` against itself.
  _needsModalStacking() {
    if (typeof document === "undefined") return false
    const modals = document.querySelectorAll("dialog:modal")
    for (const m of modals) {
      if (m !== this.dialog) return true
    }
    return false
  }

  _trackAnchorUntilSettled() {
    if (!this.anchor || typeof this.anchor.getBoundingClientRect !== "function") return
    let lastRect = this.anchor.getBoundingClientRect()
    let stableFrames = 0
    let totalFrames = 0
    const tick = () => {
      if (!this.dialog || !this._isShown()) return
      const rect = this.anchor.getBoundingClientRect()
      if (Math.abs(rect.left - lastRect.left) < 0.5 &&
          Math.abs(rect.top  - lastRect.top)  < 0.5) {
        if (++stableFrames >= 2) return
      } else {
        stableFrames = 0
        this._positionPopover()
      }
      lastRect = rect
      if (++totalFrames < 36) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // Resolve the anchor rect to position against. For most triggers
  // (buttons, block-level links) this is just getBoundingClientRect().
  // For a wrapped inline anchor — multiple line boxes — the bounding
  // rect spans the union of every line, which is too wide to position
  // against meaningfully. When we have the recorded click point, pick
  // the line-box rect containing it; otherwise fall back to the first
  // line box.
  _anchorRect() {
    const rects = typeof this.anchor.getClientRects === "function"
      ? Array.from(this.anchor.getClientRects())
      : []
    if (rects.length <= 1) return this.anchor.getBoundingClientRect()

    const click = this.anchor.__turboOverlayClickPoint
    if (click) {
      const hit = rects.find((r) =>
        click.x >= r.left && click.x <= r.right &&
        click.y >= r.top  && click.y <= r.bottom
      )
      if (hit) return hit
    }
    return rects[0]
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

    // Normalize the dialog's positioning BEFORE measuring its rect. UA
    // styles for `[popover]` and especially `dialog:modal` apply
    // `inset: 0` with `width: auto`, so the dialog stretches to fill
    // the gap; measuring then yields a width far larger than the
    // content's actual size and the auto-flip math goes wrong. Setting
    // right/bottom: auto first makes width shrink-to-fit content, so
    // `dialogRect.width` reflects the size we actually intend to render.
    this.dialog.style.position = "fixed"
    this.dialog.style.right  = "auto"
    this.dialog.style.bottom = "auto"
    this.dialog.style.margin = "0"
    this.dialog.style.transform = ""

    const anchorRect = this._anchorRect()
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

    this.dialog.style.top  = `${top}px`
    this.dialog.style.left = `${left}px`
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
  // Themes whose chrome wraps the dialog in an element that fills the
  // dialog (e.g. Bootstrap5's `<div class="modal">`, which exists to
  // scope `--bs-modal-*`) mark that wrapper with
  // `data-turbo-overlay-backdrop-zone` so clicks on its uncovered area
  // are also treated as backdrop clicks. The `-zone` suffix is
  // intentional: a plain `data-turbo-overlay-backdrop` collides with
  // the same-named attribute the link helper writes on triggers to
  // signal `backdrop: false` to the fetch hook — a bubbled link click
  // would otherwise dismiss the parent overlay.
  // Opt out per-overlay with data-turbo-overlay-backdrop-dismiss-value="false".
  backdropClick(event) {
    if (!this.backdropDismissValue) return
    const target = event.target
    if (target === this.dialog) {
      this.cancel(event)
      return
    }
    if (target && target.hasAttribute && target.hasAttribute("data-turbo-overlay-backdrop-zone")) {
      this.cancel(event)
    }
  }

  _animatedClose() {
    this._dispatch("before-close")

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
    if (this.dialog) {
      if (this.typeValue === "popover") {
        try { this.dialog.hidePopover() } catch (_) { /* not currently a popover */ }
        if (this.dialog.open) {
          try { this.dialog.close() } catch (_) { this.dialog.removeAttribute("open") }
        }
      } else if (this.dialog.open) {
        try { this.dialog.close() } catch (_) { this.dialog.removeAttribute("open") }
      }
    }
    // Dispatch :closed before _removeFrame so the dialog is still in
    // the DOM and the bubbled event reaches document-level listeners.
    this._dispatch("closed")
    this._removeFrame()
  }

  _removeFrame() {
    const frame = this.element.closest("turbo-frame.turbo-overlay-frame")
    if (frame && frame.parentNode) frame.remove()
    else if (this.element.parentNode) this.element.remove()
  }

  // `showPopover()` doesn't set the `[open]` attribute, so check `:popover-open` for popovers too.
  _isShown() {
    if (!this.dialog) return false
    if (this.dialog.open) return true
    if (this.typeValue === "popover" && this.dialog.matches) {
      try { return this.dialog.matches(":popover-open") } catch (_) { /* unsupported */ }
    }
    return false
  }

  _findStack() {
    if (typeof document === "undefined") return null
    const stackEl = document.querySelector("[data-controller~='turbo-overlay-stack']")
    if (!stackEl || !this.application) return null
    return this.application.getControllerForElementAndIdentifier(stackEl, "turbo-overlay-stack")
  }

  // Dispatch a lifecycle event on the dialog so listeners can attach
  // per-overlay; the event bubbles so document-level listeners
  // (analytics, autofocus controllers) catch it too. Detail always
  // carries `{ id, type }`. Events:
  //
  //   turbo-overlay:shown        — controller is wired and the dialog
  //                                is open + interactive.
  //   turbo-overlay:before-close — close just started, dialog still
  //                                visible (not cancellable).
  //   turbo-overlay:closed       — close animation done, dialog has
  //                                closed; frame is about to be removed.
  _dispatch(name) {
    const target = this.dialog || this.element
    if (!target) return
    target.dispatchEvent(new CustomEvent(`turbo-overlay:${name}`, {
      bubbles: true,
      detail: { id: this.idValue, type: this.typeValue }
    }))
  }
}
