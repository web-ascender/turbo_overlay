// Single source of truth for the overlay trigger contract — option
// names, dataset attribute names, request header names, encoding rules,
// type restrictions, plus the validation + dataset-build helpers that
// the JS-facing `visit()` API relies on.
//
// Three places write or read these mappings:
//   1. Ruby view helpers (`view_helper.rb`) — write dataset attributes
//      when rendering `modal_link_to` / `drawer_link_to` /
//      `popover_link_to`. Authoritative on the server side; Ruby can't
//      share this table.
//   2. `visit.js` — writes dataset attributes on a synthesized link
//      when JS code calls `TurboOverlay.visit(url, opts)`. Uses
//      `buildOverlayDataset` and `validateVisitArgs` from this file.
//   3. `setup.js` (turbo:before-fetch-request hook) — reads dataset
//      attributes off the trigger and emits the X-Turbo-Overlay-*
//      headers via `emitOverlayHeaders` from this file.
//
// (2) and (3) both consume this table. Adding a header-bearing option
// here is enough to make it round-trip through `visit()` and the fetch
// hook. The Ruby helper must still be updated in parallel.
//
// This module deliberately has no imports so it stays unit-testable
// under plain `node --test` (no DOM, no importmap).
//
// Encoding rules mirror `_overlay_normalize_link_args` at
// `lib/turbo_overlay/helpers/view_helper.rb:454-482`:
//   - `backdrop` / `close` only emit on `false` (the non-default)
//   - `keepOpenOnRedirect` only emits on `true` (the non-default)
//   - `advance` is restricted to modal/drawer
//   - everything else emits whenever a value is supplied

export const OVERLAY_OPTIONS = [
  {
    key: "id",
    dataset: "turboOverlayId",
    header: "X-Turbo-Overlay-Id",
  },
  {
    key: "position",
    dataset: "turboOverlayPosition",
    header: "X-Turbo-Overlay-Position",
  },
  {
    key: "align",
    dataset: "turboOverlayAlign",
    header: "X-Turbo-Overlay-Align",
  },
  {
    key: "offset",
    dataset: "turboOverlayOffset",
    header: "X-Turbo-Overlay-Offset",
  },
  {
    key: "backdrop",
    dataset: "turboOverlayBackdrop",
    header: "X-Turbo-Overlay-Backdrop",
    onlyWhen: (v) => v === false,
    encode: () => "false",
  },
  {
    key: "close",
    dataset: "turboOverlayClose",
    header: "X-Turbo-Overlay-Close",
    onlyWhen: (v) => v === false,
    encode: () => "false",
  },
  {
    key: "keepOpenOnRedirect",
    dataset: "turboOverlayKeepOpenOnRedirect",
    header: "X-Turbo-Overlay-Keep-Open",
    onlyWhen: (v) => v === true,
    encode: () => "true",
  },
  {
    key: "advance",
    dataset: "turboOverlayAdvance",
    onlyTypes: ["modal", "drawer"],
    encode: (v) => (v === true ? "true" : v === false ? "false" : String(v)),
  },
]

export const VALID_TYPES = ["modal", "drawer", "popover", "hint"]

// Writes dataset attributes on `el` for each option in `opts` whose
// entry passes the table's gating rules. `type` is the overlay type
// (modal/drawer/popover/hint) and is used to honor `onlyTypes`.
//
// Returns nothing; mutates `el.dataset` in place. `el` is duck-typed —
// any object with a `.dataset` property works.
export function applyOverlayOptions(el, type, opts) {
  for (const entry of OVERLAY_OPTIONS) {
    const value = opts[entry.key]
    if (value === undefined || value === null) continue
    if (entry.onlyTypes && !entry.onlyTypes.includes(type)) continue
    if (entry.onlyWhen && !entry.onlyWhen(value)) continue
    el.dataset[entry.dataset] = entry.encode ? entry.encode(value) : String(value)
  }
}

// Reads dataset attributes from a trigger element and writes the
// corresponding X-Turbo-Overlay-* headers into `headers`. Only entries
// that declare a `header` participate (e.g. `advance` is dataset-only —
// the server reads it from the response context, not a request header).
export function emitOverlayHeaders(dataset, headers) {
  for (const entry of OVERLAY_OPTIONS) {
    if (!entry.header) continue
    const value = dataset[entry.dataset]
    if (value === undefined || value === null || value === "") continue
    headers[entry.header] = value
  }
}

// Returns the dataset object that a trigger element synthesized by
// `visit()` should carry. Includes the three always-present attributes
// (`turboStream`, `turboOverlay`, `turboFrame`) plus everything written
// by `applyOverlayOptions`.
export function buildOverlayDataset(type, options = {}) {
  const target = { dataset: {} }
  target.dataset.turboStream = "true"
  target.dataset.turboOverlay = type
  target.dataset.turboFrame = options.frame || "_top"
  applyOverlayOptions(target, type, options)
  return target.dataset
}

// Validates the (url, options) pair `visit()` receives. Throws
// TypeError on misuse. Returns the resolved overlay type so callers
// don't have to re-derive it.
//
// Popovers must carry an `anchor` element — the synthesized trigger
// link has no useful bounding rect, so `setup.js` reads the anchor off
// `link.__turboOverlayAnchor` to position the popover. We skip the
// `instanceof Element` check when `Element` is undefined (the node test
// environment) so the pure validation can be unit-tested with a duck.
export function validateVisitArgs(url, options) {
  if (typeof url !== "string" || url.length === 0) {
    throw new TypeError("TurboOverlay.visit: url must be a non-empty string")
  }
  const type = options.type || "modal"
  if (!VALID_TYPES.includes(type)) {
    throw new TypeError(
      `TurboOverlay.visit: invalid type "${type}" (expected one of ${VALID_TYPES.join(", ")})`
    )
  }
  if (type === "popover") {
    const ElementCtor = typeof Element === "function" ? Element : null
    if (!options.anchor || (ElementCtor && !(options.anchor instanceof ElementCtor))) {
      throw new TypeError("TurboOverlay.visit: popover requires an `anchor` element")
    }
  }
  return type
}
