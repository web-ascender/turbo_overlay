import { buildOverlayDataset, validateVisitArgs } from "turbo_overlay/options"

// Open an overlay from JavaScript — the programmatic counterpart to
// `modal_link_to` / `drawer_link_to` / `popover_link_to`. Reuses the
// existing click pipeline: a detached `<a>` is built with the right
// `data-turbo-overlay-*` attributes, briefly attached to the document,
// clicked, and removed. Turbo's FormLinkClickObserver routes the click
// through its stream-fetch path, the gem's document click hook captures
// the trigger, and `turbo:before-fetch-request` emits the X-Turbo-Overlay-*
// headers as it does for any link click.
//
// Use this for non-anchor triggers (map pins, canvas hit-tests, custom
// elements). For ordinary HTML links, prefer the Rails helpers.
//
//   TurboOverlay.visit("/places/123")                              // modal (default)
//   TurboOverlay.visit("/cart", { type: "drawer", advance: true })
//   TurboOverlay.visit("/preview/9", { type: "popover", anchor: pinEl, position: "top" })
//
// Popovers must supply an `anchor` element — positioning derives from
// its `getBoundingClientRect()`. The synthesized link has no useful rect
// of its own.
//
// Validation, type list, and dataset construction live in `options.js`
// so they round-trip with the same table the fetch hook reads and stay
// unit-testable without a DOM.

export function visit(url, options = {}) {
  const type = validateVisitArgs(url, options)
  const link = document.createElement("a")
  link.href = url
  link.hidden = true
  link.style.position = "absolute"
  link.style.left = "-9999px"
  const dataset = buildOverlayDataset(type, options)
  for (const k in dataset) link.dataset[k] = dataset[k]
  if (options.anchor) {
    // Non-enumerable so it doesn't show up via spread/JSON, but the
    // click handler in setup.js can still read it.
    Object.defineProperty(link, "__turboOverlayAnchor", {
      value: options.anchor,
      writable: false,
      enumerable: false,
      configurable: true,
    })
  }
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
  }
}
