// Pure-function tests for the option ↔ dataset ↔ header table.
//
//   node --test test/js/options.test.js
//
// `applyOverlayOptions` writes dataset; `emitOverlayHeaders` reads
// dataset and writes headers. Both are pure (operate on plain objects),
// so we can test the round-trip without a DOM.

import test from "node:test"
import assert from "node:assert/strict"
import {
  OVERLAY_OPTIONS,
  applyOverlayOptions,
  emitOverlayHeaders,
} from "../../app/javascript/turbo_overlay/options.js"

function el() {
  return { dataset: {} }
}

test("applyOverlayOptions writes string-valued options as-is", () => {
  const e = el()
  applyOverlayOptions(e, "popover", { id: "abc", position: "top", align: "center", offset: "8" })
  assert.deepEqual(e.dataset, {
    turboOverlayId: "abc",
    turboOverlayPosition: "top",
    turboOverlayAlign: "center",
    turboOverlayOffset: "8",
  })
})

test("applyOverlayOptions omits undefined and null values", () => {
  const e = el()
  applyOverlayOptions(e, "modal", { id: undefined, position: null })
  assert.deepEqual(e.dataset, {})
})

test("backdrop only emits when explicitly false", () => {
  const yes = el(); applyOverlayOptions(yes, "modal", { backdrop: false })
  assert.equal(yes.dataset.turboOverlayBackdrop, "false")

  const no = el(); applyOverlayOptions(no, "modal", { backdrop: true })
  assert.equal(no.dataset.turboOverlayBackdrop, undefined)
})

test("close only emits when explicitly false", () => {
  const yes = el(); applyOverlayOptions(yes, "modal", { close: false })
  assert.equal(yes.dataset.turboOverlayClose, "false")

  const no = el(); applyOverlayOptions(no, "modal", { close: true })
  assert.equal(no.dataset.turboOverlayClose, undefined)
})

test("keepOpenOnRedirect only emits when explicitly true", () => {
  const yes = el(); applyOverlayOptions(yes, "modal", { keepOpenOnRedirect: true })
  assert.equal(yes.dataset.turboOverlayKeepOpenOnRedirect, "true")

  const no = el(); applyOverlayOptions(no, "modal", { keepOpenOnRedirect: false })
  assert.equal(no.dataset.turboOverlayKeepOpenOnRedirect, undefined)
})

test("advance is written for modal", () => {
  const e = el(); applyOverlayOptions(e, "modal", { advance: true })
  assert.equal(e.dataset.turboOverlayAdvance, "true")
})

test("advance is written for drawer", () => {
  const e = el(); applyOverlayOptions(e, "drawer", { advance: "/custom/path" })
  assert.equal(e.dataset.turboOverlayAdvance, "/custom/path")
})

test("advance is dropped for popover", () => {
  const e = el(); applyOverlayOptions(e, "popover", { advance: true })
  assert.equal(e.dataset.turboOverlayAdvance, undefined)
})

test("advance is dropped for hint", () => {
  const e = el(); applyOverlayOptions(e, "hint", { advance: true })
  assert.equal(e.dataset.turboOverlayAdvance, undefined)
})

test("advance: false encodes to 'false'", () => {
  const e = el(); applyOverlayOptions(e, "modal", { advance: false })
  assert.equal(e.dataset.turboOverlayAdvance, "false")
})

test("emitOverlayHeaders writes the corresponding headers from a dataset", () => {
  const dataset = {
    turboOverlayId: "abc",
    turboOverlayPosition: "top",
    turboOverlayBackdrop: "false",
    turboOverlayKeepOpenOnRedirect: "true",
    turboOverlayAdvance: "true", // dataset-only, no header
  }
  const headers = {}
  emitOverlayHeaders(dataset, headers)
  assert.deepEqual(headers, {
    "X-Turbo-Overlay-Id": "abc",
    "X-Turbo-Overlay-Position": "top",
    "X-Turbo-Overlay-Backdrop": "false",
    "X-Turbo-Overlay-Keep-Open": "true",
  })
})

test("emitOverlayHeaders skips empty-string and missing dataset keys", () => {
  const dataset = { turboOverlayId: "", turboOverlayAlign: undefined }
  const headers = {}
  emitOverlayHeaders(dataset, headers)
  assert.deepEqual(headers, {})
})

test("round-trip: applyOverlayOptions then emitOverlayHeaders preserves header-bearing options", () => {
  const opts = {
    id: "ov-1",
    position: "bottom",
    align: "end",
    offset: "12",
    backdrop: false,
    close: false,
    keepOpenOnRedirect: true,
  }
  const e = el(); applyOverlayOptions(e, "modal", opts)
  const headers = {}; emitOverlayHeaders(e.dataset, headers)
  assert.deepEqual(headers, {
    "X-Turbo-Overlay-Id": "ov-1",
    "X-Turbo-Overlay-Position": "bottom",
    "X-Turbo-Overlay-Align": "end",
    "X-Turbo-Overlay-Offset": "12",
    "X-Turbo-Overlay-Backdrop": "false",
    "X-Turbo-Overlay-Close": "false",
    "X-Turbo-Overlay-Keep-Open": "true",
  })
})

test("table covers every documented option key", () => {
  const keys = OVERLAY_OPTIONS.map((e) => e.key).sort()
  assert.deepEqual(keys, [
    "advance",
    "align",
    "backdrop",
    "close",
    "id",
    "keepOpenOnRedirect",
    "offset",
    "position",
  ])
})
