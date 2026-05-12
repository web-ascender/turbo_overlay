// Pure-function tests for computePopoverPosition.
//
//   node --test test/js/popover_position.test.js
//
// The function is imported directly from the gem's JS source. It
// takes rect-like {top, left, right, bottom, width, height} for the
// anchor and dialog (mirroring DOMRect) plus a viewport size.

import test from "node:test"
import assert from "node:assert/strict"
import { computePopoverPosition } from "../../app/javascript/turbo_overlay/popover_position.js"

function rect(top, left, width, height) {
  return { top, left, width, height, right: left + width, bottom: top + height }
}

const VIEWPORT = { width: 1000, height: 800 }

test("places below with start alignment by default", () => {
  const anchor = rect(100, 100, 80, 24)
  const dialog = rect(0,   0,   200, 120)
  const { top, left, resolvedPosition } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT
  })
  assert.equal(resolvedPosition, "bottom")
  assert.equal(top, 124 + 4)   // anchor.bottom + offset
  assert.equal(left, 100)       // align: start -> anchor.left
})

test("center alignment centers the dialog on the anchor", () => {
  const anchor = rect(100, 200, 80, 24)
  const dialog = rect(0,   0,   200, 100)
  const { left } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, align: "center"
  })
  // anchor center x = 240; dialog half-width = 100; left = 140
  assert.equal(left, 140)
})

test("end alignment right-aligns the dialog with the anchor", () => {
  const anchor = rect(100, 500, 80, 24)
  const dialog = rect(0,   0,   200, 100)
  const { left } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, align: "end"
  })
  // anchor.right = 580; left = 580 - 200 = 380
  assert.equal(left, 380)
})

test("custom offset is applied between trigger and dialog", () => {
  const anchor = rect(100, 100, 80, 24)
  const dialog = rect(0,   0,   200, 100)
  const { top } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, position: "bottom", offset: 16
  })
  assert.equal(top, 124 + 16)
})

test("auto-flips from bottom to top when bottom overflows and top has room", () => {
  // Anchor near the bottom of the viewport.
  const anchor = rect(700, 100, 80, 50)   // bottom = 750
  const dialog = rect(0,   0,   200, 120)
  const { resolvedPosition, top } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT
  })
  // bottom: 750 + 4 + 120 = 874 > 800 → flip
  // top would be 700 - 4 - 120 = 576 ≥ 0 → ok
  assert.equal(resolvedPosition, "top")
  assert.equal(top, 576)
})

test("auto-flips from top to bottom when top overflows and bottom has room", () => {
  const anchor = rect(20, 100, 80, 30)    // top = 20
  const dialog = rect(0,  0,   200, 100)
  const { resolvedPosition } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, position: "top"
  })
  // top: 20 - 4 - 100 = -84 < 0 → flip
  assert.equal(resolvedPosition, "bottom")
})

test("auto-flips from right to left near the right edge", () => {
  const anchor = rect(100, 900, 60, 30)   // right = 960
  const dialog = rect(0,   0,   200, 100)
  const { resolvedPosition } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, position: "right"
  })
  // right: 960 + 4 + 200 = 1164 > 1000 → flip
  assert.equal(resolvedPosition, "left")
})

test("auto-flips from left to right near the left edge", () => {
  const anchor = rect(100, 30, 60, 30)    // left = 30
  const dialog = rect(0,   0,  200, 100)
  const { resolvedPosition } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, position: "left"
  })
  // left: 30 - 4 - 200 = -174 < 0 → flip
  assert.equal(resolvedPosition, "right")
})

test("does not flip when autoFlip is false", () => {
  const anchor = rect(700, 100, 80, 50)
  const dialog = rect(0,   0,   200, 120)
  const { resolvedPosition } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, autoFlip: false
  })
  assert.equal(resolvedPosition, "bottom")
})

test("clamps left to viewport when start-aligned anchor is near right edge", () => {
  const anchor = rect(100, 950, 40, 24)
  const dialog = rect(0,   0,   200, 100)
  const { left } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT
  })
  // unclamped: left = 950 → would overflow to 1150.
  // clamp: vw - d.width - edgePadding(8) = 792
  assert.equal(left, 792)
})

test("clamps left to viewport with edgePadding when anchor is past viewport on left", () => {
  const anchor = rect(100, -50, 40, 24)
  const dialog = rect(0,   0,   200, 100)
  const { left } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT
  })
  // start-align would put left at -50; clamp to edgePadding=8
  assert.equal(left, 8)
})

test("right placement positions dialog to the right of the anchor", () => {
  const anchor = rect(200, 100, 80, 40)   // right = 180
  const dialog = rect(0,   0,   120, 80)
  const { top, left, resolvedPosition } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, position: "right"
  })
  assert.equal(resolvedPosition, "right")
  assert.equal(left, 184)   // anchor.right + offset(4)
  assert.equal(top, 200)    // align: start -> anchor.top
})

test("left placement positions dialog to the left of the anchor", () => {
  const anchor = rect(200, 500, 80, 40)
  const dialog = rect(0,   0,   120, 80)
  const { top, left, resolvedPosition } = computePopoverPosition({
    anchor, dialog, viewport: VIEWPORT, position: "left"
  })
  assert.equal(resolvedPosition, "left")
  assert.equal(left, 376)   // anchor.left - offset(4) - d.width = 500 - 4 - 120
  assert.equal(top, 200)
})
