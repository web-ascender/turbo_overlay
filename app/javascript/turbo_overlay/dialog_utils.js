// Small DOM helpers shared between the setup module, the per-dialog
// Stimulus controller, and the hint state machine. Kept pure-DOM (no
// imports from setup.js or controllers) so any module can depend on
// it without creating cycles.

// Close a <dialog> that may already be closed. The native close()
// throws InvalidStateError when the dialog isn't open; we strip the
// `open` attribute as a fallback so the dialog is closed after this
// returns even when close() raises (e.g. a dialog left with [open]
// but no top-layer entry, which a browser may refuse to close).
export function safelyCloseDialog(dialog) {
  if (!dialog) return
  try { dialog.close() } catch (_) { dialog.removeAttribute("open") }
}

// Dismiss a popover-mode dialog. hidePopover() is only available in
// browsers that support the Popover API, and throws when the dialog
// isn't showing as a popover. Both are non-fatal — callers want
// "ensure popover is hidden."
export function safelyHidePopover(dialog) {
  if (!dialog || typeof dialog.hidePopover !== "function") return
  try { dialog.hidePopover() } catch (_) { /* not currently a popover */ }
}

// Reset a <dialog>'s positioning styles so popover-positioning math
// can place it via a single `transform: translate(...)`. Default
// <dialog> styles (margin: auto, right/bottom set, position relative
// or absolute depending on open state) and the `dialog:modal` UA
// `inset: 0` interfere with anchored placement.
//
// We pin the dialog at viewport origin (top: 0, left: 0) and carry
// the actual placement on `transform`. Transforms run on the
// compositor thread, so they stay in sync with scroll-induced repaint
// instead of trailing by a frame (which produces a "springy" feel on
// momentum scrolling). The CSS for popovers sets
// `animation-composition: add` so the entry/exit keyframes compose
// with our positioning transform instead of overriding it.
export function normalizePopoverDialogStyles(dialog) {
  if (!dialog) return
  dialog.style.position = "fixed"
  dialog.style.top      = "0"
  dialog.style.left     = "0"
  dialog.style.right    = "auto"
  dialog.style.bottom   = "auto"
  dialog.style.margin   = "0"
}
