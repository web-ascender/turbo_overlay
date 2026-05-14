import { Controller } from "@hotwired/stimulus"
import { computePopoverPosition } from "turbo_overlay/popover_position"
import { safelyCloseDialog, safelyHidePopover, normalizePopoverDialogStyles } from "turbo_overlay/dialog_utils"
import { shouldCloseOnRedirect, isSamePageRedirect } from "turbo_overlay/submit_close"
import {
  getAdvanceUrl, clearAdvanceUrl,
  markPushed, isPushed, clearPushed, livePushedCount,
  pushOverlayState, reverseHistoryForClose,
  getStackController
} from "turbo_overlay/history"

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

    // Track every mousedown's target so the dismissal guard can
    // distinguish "user clicked the backdrop" from "user dragged a
    // text selection out of the dialog and released on the backdrop"
    // (W3C clicks resolve to the LCA of mousedown and mouseup —
    // dialog itself, in the drag case). Capture phase so we see the
    // event before any other handler.
    this._mousedownTracker = (event) => { this._lastMousedownTarget = event.target }
    document.addEventListener("mousedown", this._mousedownTracker, true)

    this._captureOpenerUrl()

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
    this._maybeAdvanceHistory()
    this._installSubmitEndHandler()
  }

  disconnect() {
    if (this._submitEndHandler && this.dialog) {
      this.dialog.removeEventListener("turbo:submit-end", this._submitEndHandler)
      this._submitEndHandler = null
    }
    if (this._beforeFetchResponseHandler && this.dialog) {
      this.dialog.removeEventListener("turbo:before-fetch-response", this._beforeFetchResponseHandler)
      this._beforeFetchResponseHandler = null
    }
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler)
      this._escHandler = null
    }
    if (this._outsideClickHandler) {
      document.removeEventListener("mousedown", this._outsideClickHandler, true)
      this._outsideClickHandler = null
    }
    if (this._mousedownTracker) {
      document.removeEventListener("mousedown", this._mousedownTracker, true)
      this._mousedownTracker = null
    }
    this._lastMousedownTarget = null
    this._allowedSelectors = null
    if (this._reflowHandler) {
      window.removeEventListener("scroll", this._reflowHandler, true)
      window.removeEventListener("resize", this._reflowHandler)
      this._reflowHandler = null
    }
    if (this._reflowFrame) {
      cancelAnimationFrame(this._reflowFrame)
      this._reflowFrame = null
    }
    if (this._anchorObserver) {
      this._anchorObserver.disconnect()
      this._anchorObserver = null
    }
    if (this._anchorOutTimer) {
      clearTimeout(this._anchorOutTimer)
      this._anchorOutTimer = null
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

  // Record the URL the overlay was opened from so the submit-end
  // handler can decide whether a redirect target is "same page"
  // (morph the page behind, then animate close) or different
  // (await close, then Turbo.visit). Captured once per dialog node —
  // `advance` pushes happen after `connect`, and frame re-renders
  // morph the dialog in place with the data attribute preserved by
  // the morph-attribute hook in setup.js, so the capture-once guard
  // keeps the opener URL stable through validation re-renders.
  // Modal/drawer only — popovers/hints don't host redirect-y forms.
  _captureOpenerUrl() {
    if (this.typeValue !== "modal" && this.typeValue !== "drawer") return
    if (!this.dialog) return
    if (this.dialog.dataset.turboOverlayOpenerUrl) return
    if (typeof window === "undefined" || !window.location) return
    this.dialog.dataset.turboOverlayOpenerUrl = window.location.href
  }

  // Close-on-redirect: when a descendant form submits and Turbo
  // followed a redirect to the final response, dismiss this overlay
  // and navigate. The listener is scoped to this dialog (not
  // document) so stacking works — only the dialog containing the
  // form closes — and so the listener auto-cleans on disconnect.
  //
  // Two paths after `shouldCloseOnRedirect` returns true:
  //
  //   - Same-page redirect (pathname matches the URL the overlay was
  //     opened from) on a lone overlay → `_morphAndClose`: fetch the
  //     redirect target, morph the host page behind the overlay,
  //     then animate the close. No `Turbo.visit` — page is correct.
  //
  //   - Different page, or sibling overlay in the stack → await the
  //     close animation, then `Turbo.visit`. Awaiting avoids the
  //     flash where the new page paints behind a still-closing
  //     overlay.
  //
  // Pure decisions live in submit_close.js for testability.
  _installSubmitEndHandler() {
    if (!this.dialog) return

    // Stop Turbo from rendering a close-bound redirect response into
    // the open overlay. Fetch follows the redirect transparently and
    // carries the original `Turbo-Frame` / `X-Turbo-Overlay` headers
    // on the same-origin follow, so the controller concern wraps the
    // redirect target in overlay layout — Turbo would then morph that
    // payload into the open dialog, briefly showing the wrong content
    // before our submit-end handler closes (or morph-closes) it.
    //
    // `preventDefault` alone isn't enough: Turbo's StreamObserver
    // listens on the same event at the window level and does its own
    // `receiveMessageResponse` (which processes the
    // `<turbo-stream method="morph">` action and morphs the frame)
    // independent of `defaultPrevented`. The fix is to stop the
    // event before it reaches the window. The dialog listener fires
    // in the bubble phase before window's, so
    // `stopImmediatePropagation` keeps StreamObserver from receiving
    // it. `preventDefault` is still needed so FormSubmission's own
    // success path takes the `requestPreventedHandlingResponse`
    // branch (no frame replace).
    //
    // Same predicate as the submit-end handler — when we'd close the
    // overlay, we own the response. The keep-open opt-outs naturally
    // pass through: `shouldCloseOnRedirect` returns false →
    // pass-through → Turbo renders the response normally
    // (wizard-style flows). Non-redirect responses (validation
    // 422s, raw 200s) likewise pass through, so morph re-renders are
    // unaffected.
    this._beforeFetchResponseHandler = (event) => {
      if (!shouldCloseOnRedirect({
        form: event.target,
        dialog: this.dialog,
        fetchResponse: event.detail && event.detail.fetchResponse
      })) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    this.dialog.addEventListener("turbo:before-fetch-response", this._beforeFetchResponseHandler)

    this._submitEndHandler = async (event) => {
      const fetchResponse = event.detail && event.detail.fetchResponse
      if (!shouldCloseOnRedirect({
        form: event.target,
        dialog: this.dialog,
        fetchResponse
      })) return
      const url = fetchResponse.response && fetchResponse.response.url
      const canMorph = !this._stackHasSiblings() &&
        isSamePageRedirect({ dialog: this.dialog, fetchResponse })
      if (canMorph && url) {
        const morphed = await this._morphAndClose(url, event)
        if (morphed) return
        // fall through on morph failure
      }
      await this.close(event)
      if (url && typeof window !== "undefined" && window.Turbo && typeof window.Turbo.visit === "function") {
        window.Turbo.visit(url)
      }
    }
    this.dialog.addEventListener("turbo:submit-end", this._submitEndHandler)
  }

  // True when another overlay is open in the same stack. Used to
  // skip the morph-behind path: morphing the body while a sibling
  // overlay is rendered (and the URL bar belongs to a sibling's
  // advanced entry) would clobber state we can't safely reconstruct.
  _stackHasSiblings() {
    const stack = getStackController()
    return !!(stack && stack.entries && stack.entries.length > 1)
  }

  // Fetch the redirect target, morph the host page behind the
  // overlay (preserving the open dialog), update the URL bar to the
  // redirect URL, then animate the close.
  //
  // Returns true on success, false on any failure (caller falls back
  // to the await-close-then-visit path). Never throws.
  async _morphAndClose(url, event) {
    if (typeof window === "undefined" || !window.Turbo) return false
    if (typeof window.Turbo.morphChildren !== "function") return false

    let html
    try {
      html = await this._fetchOpenerHTML(url)
    } catch (_) {
      return false
    }
    if (!html) return false

    let doc
    try {
      doc = new DOMParser().parseFromString(html, "text/html")
    } catch (_) {
      return false
    }
    if (!doc || !doc.body) return false

    // Morph first; only update history and close if the morph
    // succeeds. If morph throws, the URL bar is unchanged so the
    // caller's fallback `Turbo.visit(url)` can navigate cleanly.
    try {
      window.Turbo.morphChildren(document.body, doc.body, {
        ignoreActiveValue: true,
        callbacks: {
          beforeNodeMorphed: (oldNode) => {
            if (!oldNode || !oldNode.closest) return true
            // Exclude the open overlay + sibling overlays from morph.
            return !oldNode.closest("[data-controller~='turbo-overlay-stack']")
          }
        }
      })
    } catch (_) {
      return false
    }

    try {
      window.history.replaceState(null, "", url)
    } catch (_) {
      // cross-origin URL or other replaceState rejection — leave the
      // URL bar pointing at the prior entry. The body is correctly
      // morphed; the URL mismatch is acceptable degradation.
    }

    // Suppress `_syncHistoryOnClose` from running `history.back()` —
    // we already replaced the current history entry to land on the
    // redirect URL directly, regardless of whether the overlay was
    // advanced.
    this._closedByBack = true
    await this.close(event)
    return true
  }

  async _fetchOpenerHTML(url) {
    const init = {
      headers: { "Accept": "text/html" },
      credentials: "same-origin"
    }
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(3000)
    }
    const response = await fetch(url, init)
    if (!response.ok) throw new Error(`fetch ${response.status}`)
    return await response.text()
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
      if (target === this.dialog) {
        if (this._shouldSuppressDismiss(target)) return
        this.cancel(event); return
      }
      if (this.dialog.contains(target)) return
      if (this.anchor && this.anchor.contains && this.anchor.contains(target)) return
      if (this._shouldSuppressDismiss(target)) return
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

    this._installAnchorVisibilityObserver()

    this._dispatch("shown")
    this._installSubmitEndHandler()
  }

  // Auto-close the popover when its anchor scrolls out of view. A
  // popover whose trigger isn't visible reads as a floating widget
  // with no obvious connection to anything — Bootstrap, MUI, Floating
  // UI, and native iOS UIPopover all collapse on this signal. A short
  // debounce avoids closing on momentum-scroll frames that briefly
  // clip the anchor edge before settling back into view.
  //
  // The reflow handler keeps repositioning the popover during the
  // debounce and the close animation — that's deliberate. Top-layer
  // popovers are positioned in viewport coordinates; without
  // continuous updates the popover stays glued to the screen while
  // the anchor scrolls past it (the "sticky-nav" look). Continuing to
  // track means the popover scrolls offscreen alongside the anchor,
  // and the close animation plays as it goes.
  //
  // 50ms = ~3 frames at 60Hz, enough to ride out a one-frame inertial
  // overshoot but short enough that the dismissal feels responsive.
  _installAnchorVisibilityObserver() {
    if (typeof IntersectionObserver === "undefined") return
    if (!this.anchor || typeof this.anchor.getBoundingClientRect !== "function") return

    this._anchorObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (!entry) return
      if (entry.isIntersecting) {
        if (this._anchorOutTimer) {
          clearTimeout(this._anchorOutTimer)
          this._anchorOutTimer = null
        }
      } else {
        if (this._anchorOutTimer) return
        this._anchorOutTimer = setTimeout(() => {
          this._anchorOutTimer = null
          if (this.dialog && this._isShown()) this.cancel()
        }, 50)
      }
    }, { threshold: 0 })
    this._anchorObserver.observe(this.anchor)
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

    // Pin the dialog at viewport origin and carry placement on
    // `transform`. Transforms run on the compositor thread, so the
    // popover stays in lock-step with scroll-induced repaint instead
    // of trailing by a frame. The CSS for popovers sets
    // `animation-composition: add` so the open/close keyframes
    // compose with our inline transform rather than overriding it.
    //
    // Normalize BEFORE measuring the dialog's natural size. The UA
    // styles for `[popover]` and especially `dialog:modal` apply
    // `inset: 0` with `width: auto`, which stretches the dialog to
    // fill the viewport; measuring then yields a width far larger
    // than the content and auto-flip goes wrong. After
    // `normalizePopoverDialogStyles` the dialog shrinks to content.
    normalizePopoverDialogStyles(this.dialog)

    const anchorRect = this._anchorRect()
    // `offsetWidth/offsetHeight` ignore the current transform and
    // return the laid-out box, which is what auto-flip math needs.
    // `getBoundingClientRect()` here would include our prior
    // positioning transform and bias the size measurement.
    const dialogWidth  = this.dialog.offsetWidth
    const dialogHeight = this.dialog.offsetHeight
    const dialogRect = {
      top: 0, left: 0,
      right: dialogWidth, bottom: dialogHeight,
      width: dialogWidth, height: dialogHeight,
    }
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

    this.dialog.style.transform = `translate(${left}px, ${top}px)`
    this.dialog.dataset.resolvedPosition = resolvedPosition
  }

  // data-action="click->turbo-overlay#close"
  // Returns a Promise that resolves when the close animation has
  // finished and `_finalizeClose` has run. Callers that need to act
  // after the overlay is fully closed (e.g., the submit-end handler
  // gating `Turbo.visit` on animation completion) can `await` it.
  close(event) {
    if (event) event.preventDefault()
    const snapshot = this.stack && this.stack.entries ? this.stack.entries.slice() : []
    if (this.stack) this.stack.unregister(this.idValue)
    this._syncHistoryOnClose(snapshot)
    return this._animatedClose()
  }

  // data-action="cancel->turbo-overlay#cancel" — native dialog ESC.
  // Prevent the immediate close so we can animate; stop propagation
  // so ESC doesn't bubble to the dialog beneath in the stack.
  // Returns the same Promise as `close`.
  cancel(event) {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    const snapshot = this.stack && this.stack.entries ? this.stack.entries.slice() : []
    if (this.stack) this.stack.unregister(this.idValue)
    this._syncHistoryOnClose(snapshot)
    return this._animatedClose()
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
    if (this._shouldSuppressDismiss(event.target)) return
    const target = event.target
    if (target === this.dialog) {
      this.cancel(event)
      return
    }
    if (target && target.hasAttribute && target.hasAttribute("data-turbo-overlay-backdrop-zone")) {
      this.cancel(event)
    }
  }

  // Returns true when an apparent outside/backdrop click should NOT
  // dismiss the overlay. Two cases:
  //
  // 1. Drag-out: the user mousedown'd inside the dialog content and
  //    released on the backdrop. The W3C click target is the dialog
  //    itself (LCA of mousedown/mouseup), so `backdropClick` would
  //    otherwise treat it as a dismissal — but the user was selecting
  //    text, not dismissing.
  //
  // 2. Allowlist match: the click landed on an element matching a
  //    configured CSS selector (e.g. `.flatpickr-calendar`,
  //    `.select2-container`). These widgets portal their UI to
  //    `<body>` and read as outside-dialog clicks even when the user
  //    is interacting with a widget rendered from inside the overlay.
  _shouldSuppressDismiss(clickTarget) {
    const mousedownTarget = this._lastMousedownTarget
    if (mousedownTarget && this.dialog &&
        this.dialog.contains(mousedownTarget) &&
        mousedownTarget !== this.dialog) {
      return true
    }
    if (this._isAllowlisted(mousedownTarget)) return true
    if (this._isAllowlisted(clickTarget)) return true
    return false
  }

  _isAllowlisted(target) {
    if (!target || !target.closest) return false
    const selectors = this._resolveAllowedSelectors()
    if (!selectors.length) return false
    for (const selector of selectors) {
      try {
        if (target.closest(selector)) return true
      } catch (_) {
        // Malformed selector. Skip it; a single bad entry must not
        // break dismissal for everything else. Warn once per dialog.
        if (!this._warnedSelectors) this._warnedSelectors = new Set()
        if (!this._warnedSelectors.has(selector)) {
          this._warnedSelectors.add(selector)
          // eslint-disable-next-line no-console
          console.warn(`[turbo_overlay] ignoring invalid allowed_click_outside_selectors entry: ${selector}`)
        }
      }
    }
    return false
  }

  _resolveAllowedSelectors() {
    if (this._allowedSelectors) return this._allowedSelectors
    const override = this.dialog && this.dialog.dataset
      ? this.dialog.dataset.turboOverlayAllowClickOutside
      : null
    if (override != null) {
      this._allowedSelectors = override
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      return this._allowedSelectors
    }
    if (this.stack && Array.isArray(this.stack.allowedClickOutsideSelectorsValue)) {
      this._allowedSelectors = this.stack.allowedClickOutsideSelectorsValue
      return this._allowedSelectors
    }
    this._allowedSelectors = []
    return this._allowedSelectors
  }

  // Returns a Promise that resolves after `_finalizeClose` runs. The
  // promise never rejects — even the no-dialog and reduced-motion
  // shortcuts resolve through `_finalizeClose` synchronously, so
  // awaiting callers can rely on "after this, the overlay is gone."
  _animatedClose() {
    this._dispatch("before-close")

    if (!this.dialog) {
      this._removeFrame()
      return Promise.resolve()
    }

    const reduced = typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (reduced || !this.dialog.open) {
      this._finalizeClose()
      return Promise.resolve()
    }

    const target = this.element
    target.classList.add(CLOSING_CLASS)

    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        target.removeEventListener("animationend", onEnd)
        this._finalizeClose()
        resolve()
      }
      const onEnd = (event) => {
        // Animations on inner elements may also fire; only finalize
        // when the dialog (or its ::backdrop) finishes.
        if (event.target !== target) return
        finish()
      }
      target.addEventListener("animationend", onEnd)
      setTimeout(finish, CLOSE_ANIMATION_TIMEOUT_MS)
    })
  }

  _finalizeClose() {
    if (this.dialog) {
      if (this.typeValue === "popover") {
        safelyHidePopover(this.dialog)
        if (this.dialog.open) safelyCloseDialog(this.dialog)
      } else if (this.dialog.open) {
        safelyCloseDialog(this.dialog)
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

  // URL advance: push the link's target (or a custom URL) into the
  // history bar when a modal or drawer first opens. Popovers and
  // hints never advance — they're ephemeral. The pushed entry is
  // tracked by overlay id in a module-level Map so the bookkeeping
  // survives idiomorph re-renders and any Stimulus reconnects.
  _maybeAdvanceHistory() {
    if (this.typeValue !== "modal" && this.typeValue !== "drawer") return
    const url = getAdvanceUrl(this.idValue)
    if (!url) return
    try {
      pushOverlayState(this.idValue, this.typeValue, url)
      markPushed(this.idValue, url, this.typeValue)
    } catch (_) {
      // pushState can throw on cross-origin URLs; treat as a no-op.
    }
    clearAdvanceUrl(this.idValue)
  }

  // Reverse the history entry we pushed on open when this close
  // actually removes the top-most pushed overlay from the stack.
  //   - _closedByBack: this close was triggered by a popstate; the
  //     browser already moved the history pointer, so we must not
  //     also history.back() (that would skip a real prior entry).
  //   - livePushedCount comparison: handles mid-stack closes
  //     correctly. The mid-stack overlay's `pushed` record was below
  //     the top's in history, so going back wouldn't recover its
  //     URL; only the count drop matters.
  _syncHistoryOnClose(stackBefore) {
    const id = this.idValue
    if (!isPushed(id)) return
    if (this._closedByBack) {
      clearPushed(id)
      return
    }
    const before = livePushedCount(stackBefore)
    clearPushed(id)
    const after = livePushedCount(this.stack && this.stack.entries ? this.stack.entries : [])
    if (after < before) reverseHistoryForClose()
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
