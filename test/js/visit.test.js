// Tests for the pure helpers that back `TurboOverlay.visit()` —
// input validation and dataset construction. Both live in `options.js`
// alongside the round-trip table so they share the import-free module
// and are runnable under plain `node --test` (no DOM, no importmap).
//
//   node --test test/js/visit.test.js
//
// The full DOM round-trip (synthesize anchor, dispatch click, header
// emission, server response) is covered by the system test in
// test/system/overlay_test.rb.

import test from "node:test"
import assert from "node:assert/strict"
import {
  buildOverlayDataset,
  validateVisitArgs,
} from "../../app/javascript/turbo_overlay/options.js"

test("buildOverlayDataset writes the common attributes", () => {
  const ds = buildOverlayDataset("modal", {})
  assert.equal(ds.turboStream, "true")
  assert.equal(ds.turboOverlay, "modal")
  assert.equal(ds.turboFrame, "_top")
})

test("buildOverlayDataset honors custom frame", () => {
  const ds = buildOverlayDataset("modal", { frame: "main" })
  assert.equal(ds.turboFrame, "main")
})

test("buildOverlayDataset forwards table-driven options", () => {
  const ds = buildOverlayDataset("popover", {
    id: "x",
    position: "top",
    align: "center",
    offset: "8",
  })
  assert.equal(ds.turboOverlayId, "x")
  assert.equal(ds.turboOverlayPosition, "top")
  assert.equal(ds.turboOverlayAlign, "center")
  assert.equal(ds.turboOverlayOffset, "8")
})

test("buildOverlayDataset writes advance for modal", () => {
  const ds = buildOverlayDataset("modal", { advance: true })
  assert.equal(ds.turboOverlayAdvance, "true")
})

test("buildOverlayDataset drops advance for popover", () => {
  const ds = buildOverlayDataset("popover", { advance: true })
  assert.equal(ds.turboOverlayAdvance, undefined)
})

test("buildOverlayDataset drops advance for hint", () => {
  const ds = buildOverlayDataset("hint", { advance: true })
  assert.equal(ds.turboOverlayAdvance, undefined)
})

test("buildOverlayDataset omits backdrop:true (default), keeps backdrop:false", () => {
  const yes = buildOverlayDataset("modal", { backdrop: false })
  assert.equal(yes.turboOverlayBackdrop, "false")

  const no = buildOverlayDataset("modal", { backdrop: true })
  assert.equal(no.turboOverlayBackdrop, undefined)
})

test("validateVisitArgs rejects empty url", () => {
  assert.throws(() => validateVisitArgs("", {}), TypeError)
  assert.throws(() => validateVisitArgs(undefined, {}), TypeError)
  assert.throws(() => validateVisitArgs(123, {}), TypeError)
})

test("validateVisitArgs rejects unknown type", () => {
  assert.throws(() => validateVisitArgs("/x", { type: "tooltip" }), TypeError)
})

test("validateVisitArgs returns the resolved type, defaulting to modal", () => {
  assert.equal(validateVisitArgs("/x", {}), "modal")
  assert.equal(validateVisitArgs("/x", { type: "drawer" }), "drawer")
})

test("validateVisitArgs requires anchor for popover", () => {
  assert.throws(
    () => validateVisitArgs("/x", { type: "popover" }),
    /popover requires an `anchor`/
  )
  assert.throws(
    () => validateVisitArgs("/x", { type: "popover", anchor: null }),
    /popover requires an `anchor`/
  )
})

test("validateVisitArgs accepts popover with a truthy anchor when Element global absent", () => {
  // In the node test environment, `Element` is undefined, so the
  // instanceof check is skipped. We just need a truthy anchor.
  assert.equal(
    validateVisitArgs("/x", { type: "popover", anchor: { tagName: "DIV" } }),
    "popover"
  )
})

test("modal/drawer/hint do not require anchor", () => {
  assert.equal(validateVisitArgs("/x", { type: "modal" }), "modal")
  assert.equal(validateVisitArgs("/x", { type: "drawer" }), "drawer")
  assert.equal(validateVisitArgs("/x", { type: "hint" }), "hint")
})
