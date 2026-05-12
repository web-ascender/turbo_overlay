// Pure positioning math for anchored popovers (and, in a later
// phase, hover hints). Given the anchor and dialog rectangles plus
// a viewport, returns { top, left, resolvedPosition } in viewport
// (CSS `position: fixed`) coordinates.
//
// Supports:
//   - position: "top" | "bottom" | "left" | "right"
//   - align:    "start" | "center" | "end"  (cross-axis)
//   - offset:   pixel gap between anchor edge and dialog edge
//   - autoFlip: if true, swap to the opposite side when the preferred
//               placement would overflow the viewport AND the opposite
//               side has room.
//
// The result is clamped on the cross axis to keep the dialog at
// least `edgePadding` pixels inside the viewport. The primary axis is
// not clamped — auto-flip handles that and clamping would defeat the
// anchor relationship.

const DEFAULT_OFFSET = 4
const DEFAULT_EDGE_PADDING = 8

export function computePopoverPosition({
  anchor,
  dialog,
  viewport,
  position = "bottom",
  align = "start",
  offset = DEFAULT_OFFSET,
  autoFlip = true,
  edgePadding = DEFAULT_EDGE_PADDING
}) {
  const a  = anchor
  const d  = dialog
  const vw = viewport.width
  const vh = viewport.height
  const off = Number.isFinite(offset) ? offset : DEFAULT_OFFSET

  let resolved = position

  if (autoFlip) {
    if (resolved === "bottom" && a.bottom + off + d.height > vh && a.top    - off - d.height >= 0) resolved = "top"
    else if (resolved === "top"    && a.top    - off - d.height < 0  && a.bottom + off + d.height <= vh) resolved = "bottom"
    else if (resolved === "right"  && a.right  + off + d.width  > vw && a.left   - off - d.width  >= 0) resolved = "left"
    else if (resolved === "left"   && a.left   - off - d.width  < 0  && a.right  + off + d.width  <= vw) resolved = "right"
  }

  let top, left
  if (resolved === "bottom" || resolved === "top") {
    top = resolved === "bottom" ? a.bottom + off : a.top - off - d.height
    if      (align === "center") left = a.left + (a.width  / 2) - (d.width  / 2)
    else if (align === "end")    left = a.right - d.width
    else                          left = a.left
    // Clamp on the parallel (cross) axis.
    left = Math.max(edgePadding, Math.min(left, vw - d.width - edgePadding))
  } else {
    left = resolved === "right" ? a.right + off : a.left - off - d.width
    if      (align === "center") top = a.top + (a.height / 2) - (d.height / 2)
    else if (align === "end")    top = a.bottom - d.height
    else                          top = a.top
    top = Math.max(edgePadding, Math.min(top, vh - d.height - edgePadding))
  }

  return { top, left, resolvedPosition: resolved }
}
