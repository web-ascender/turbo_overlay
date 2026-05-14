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
// can place it via top/left. Default <dialog> styles (margin: auto,
// right/bottom set, position relative or absolute depending on open
// state) interfere with anchored placement.
export function normalizePopoverDialogStyles(dialog) {
  if (!dialog) return
  dialog.style.position = "fixed"
  dialog.style.right    = "auto"
  dialog.style.bottom   = "auto"
  dialog.style.margin   = "0"
}
