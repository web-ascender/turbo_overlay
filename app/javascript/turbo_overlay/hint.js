import { computePopoverPosition } from "turbo_overlay/popover_position"

// Hover-triggered hint previews for turbo_overlay.
//
// Self-bootstraps on import. Uses delegated document listeners so it
// doesn't need to attach to individual links. Reads showDelay /
// hideDelay lazily from the stack element (`overlay_stack_tag`) — no
// Stimulus values, no controller.
//
// Lifecycle:
//   - Hover a hint-marked link → after `show_delay_ms`, paint a
//     pending placeholder (cloned from `turbo_overlay_loading_hint_template`).
//   - Real content lands → swap in place (cache hit, prefetch
//     response, or explicit `hint_url:` fetch).
//   - Response carries no `<template id="…">` → dismiss silently.
//   - User hovers away → dismiss (with `hide_delay_ms` grace window).
//   - Navigation / click → drop everything.
//
// Update semantics: when a refreshed prefetch arrives for a URL that's
// currently displayed as a live hint (rare — Turbo dedupes prefetches),
// the cache is updated but the visible bubble stays as-is. The next
// hover shows the refreshed content. This avoids mid-read flicker;
// it also means hints can be slightly stale relative to the latest
// prefetch.
//
// Negative caching: when a hint-marked URL is fetched and returns a
// response with no `<template id>` (or the fetch errors out), the
// cache stores a `NO_HINT` sentinel for that URL. Subsequent hovers
// short-circuit at the show_delay tick without painting a pending
// placeholder. The negative cache clears on `turbo:visit`, so a page
// navigation gives the gem a fresh chance to discover a hint.
//
// Safety-net cap: the pending placeholder auto-dismisses after
// MAX_PENDING_MS (10s) if neither a `hint-ready` nor a
// `fetch-request-error` event arrives. Turbo doesn't dispatch on
// silently-cancelled prefetches (e.g. queue eviction) and the browser
// won't time out a hung server fetch, so this is the backstop. NO_HINT
// is cached when it fires so retries wait for the next page visit.
//
// Three content sources, one extraction path:
//
//   1. Turbo's hover prefetch (plain links, prefetch enabled).
//      FetchRequest dispatches `turbo:before-fetch-response` for every
//      fetch including prefetch; we listen, extract a `<template id="…">`
//      from the response, and cache the fragment by URL.
//
//   2. Manual prefetch-style fetch (plain links, prefetch disabled).
//      When the site sets `<meta name="turbo-prefetch" content="false">`
//      or the link/ancestor carries `data-turbo-prefetch="false"`,
//      Turbo won't fire a prefetch for us. The module falls back
//      to a plain `fetch()` of the link's href so hints still work.
//
//   3. Explicit `hint_url:` (for overlay links Turbo refuses to
//      prefetch — modal/drawer/popover_link_to set data-turbo-stream
//      which excludes them from hover prefetch). The module
//      fetches the hint URL with the `:hint` request variant on
//      hover and extracts the same `<template id="…">` shape.
//
// All three producers emit:
//
//   <template id="turbo-overlay-hint">
//     <div class="turbo-overlay-hint" role="tooltip">...body...</div>
//   </template>
//
// so the extractor doesn't branch on source.
//
// Detection is best-effort: we mirror Turbo's two common opt-out
// switches (meta and dataset). Other reasons Turbo might decline
// (cross-origin, non-GET, etc.) aren't relevant for `hint_link_to`,
// which always emits a same-origin GET.

const CACHE_LIMIT = 50

// Safety-net cap on how long the pending placeholder can spin before
// we give up. The happy path resolves via `hint-ready` (fetch success)
// or `fetch-request-error` (network failure). This catches the cases
// where neither fires: Turbo silently cancelling a queued prefetch,
// an indefinitely-hung server, or a browser that swallows the fetch
// event lifecycle. Cached as NO_HINT so a retry only happens after
// the next page visit.
const MAX_PENDING_MS = 10000

// Sentinel cached against a URL that we know has no hint template (or
// whose prefetch failed). Distinguishes "fetched and confirmed empty"
// from "never fetched", so we (a) don't paint a pending placeholder
// for a link we've already confirmed has nothing to show and (b)
// dismiss any in-flight pending immediately if the response already
// arrived during the show_delay window.
const NO_HINT = Symbol("turbo-overlay-no-hint")

const TEMPLATE_ID = "turbo-overlay-hint"

const DEFAULTS = {
  showDelay: 250,
  hideDelay: 120
}

const hintCache = new Map()
let current = null  // { link, url, element }
let pending = null  // { link, url, showTimer, fetchController, awaitTimer, hintReadyHandler }
let previousAriaDescribedBy = null

// Read show/hide delays from the stack tag (`overlay_stack_tag`).
// Returns defaults if the stack element is absent (e.g. before the
// host page renders it). Re-read on every event so the values track
// late mounts and back/forward restores.
function readConfig() {
  const stack = typeof document !== "undefined"
    ? document.querySelector("[data-controller~='turbo-overlay-stack']")
    : null
  if (!stack) return DEFAULTS

  const d = stack.dataset
  const showAttr = d.turboOverlayHintShowDelay
  const hideAttr = d.turboOverlayHintHideDelay

  return {
    showDelay: showAttr == null ? DEFAULTS.showDelay : (parseInt(showAttr, 10) || DEFAULTS.showDelay),
    hideDelay: hideAttr == null ? DEFAULTS.hideDelay : (parseInt(hideAttr, 10) || DEFAULTS.hideDelay)
  }
}

function hintsActive() {
  if (typeof window === "undefined") return false
  if (window.matchMedia && window.matchMedia("(hover: none)").matches) return false
  return true
}

// ----- event handlers -----

function onMouseOver(event) {
  if (!hintsActive()) return
  const link = closestHintLink(event.target)
  if (!link) return
  hoverEnter(link)
}

function onMouseOut(event) {
  const link = closestHintLink(event.target)
  if (!link) return
  const moveTo = event.relatedTarget
  if (moveTo && link.contains(moveTo)) return
  const active = activeHintElement()
  if (active && moveTo && active.contains(moveTo)) return
  hoverLeave(link)
}

function activeHintElement() {
  if (current && current.element) return current.element
  if (pending && pending.element) return pending.element
  return null
}

function onFocusIn(event) {
  if (!hintsActive()) return
  const link = closestHintLink(event.target)
  if (!link) return
  hoverEnter(link)
}

function onFocusOut(event) {
  const link = closestHintLink(event.target)
  if (!link) return
  hoverLeave(link)
}

function onKeyDown(event) {
  if (event.key === "Escape" && current) {
    dismissCurrent()
  }
}

function onTurboVisit() {
  hintCache.clear()
  cancelPending()
  dismissCurrent({ animate: false })
}

function onTurboClick() {
  cancelPending()
}

// FetchRequest dispatches before-fetch-response for every fetch
// (navigation, prefetch, preload, form). For any response whose
// request URL matches a hint-marked link in the DOM, parse the body
// for a hint template and cache the fragment.
async function onTurboFetchResp(event) {
  const detail = event.detail || {}
  const response = detail.fetchResponse && detail.fetchResponse.response
  if (!response) return

  const requestUrl = response.url || (detail.url && detail.url.toString())
  if (!requestUrl) return

  if (!anyHintLinkMatches(requestUrl)) return

  let fragment = null
  if (response.ok) {
    try {
      fragment = await extractHintFragment(response)
    } catch (_) {
      fragment = null
    }
  }

  const value = fragment || NO_HINT
  cacheFragment(requestUrl, value)
  if (response.url && response.url !== requestUrl) cacheFragment(response.url, value)

  document.dispatchEvent(new CustomEvent("turbo-overlay:hint-ready", {
    detail: { url: requestUrl, fragment: fragment }
  }))
}

function onTurboFetchError(event) {
  const detail = event.detail || {}
  const request = detail.request || detail.fetchRequest
  if (!request) return
  const requestUrl = request.url && (typeof request.url.toString === "function" ? request.url.toString() : String(request.url))
  if (!requestUrl) return
  if (!anyHintLinkMatches(requestUrl)) return

  // Network failure for a hint-marked URL. Treat as "no hint" so we
  // don't strand a pending spinner and don't retry on the next hover
  // until the next page visit clears the cache.
  cacheFragment(requestUrl, NO_HINT)

  document.dispatchEvent(new CustomEvent("turbo-overlay:hint-ready", {
    detail: { url: requestUrl, fragment: null }
  }))
}

// ----- hover state machine -----

function hoverEnter(link) {
  if (current && current.link === link) {
    cancelHideTimer()
    return
  }

  if (pending && pending.link !== link) cancelPending()
  if (pending && pending.link === link) {
    cancelHideTimer()
    return
  }

  const url = link.dataset.turboOverlayHintUrl || link.href
  if (!url) return

  const delay = readConfig().showDelay
  const showTimer = setTimeout(() => onShowTimerFire(link, url), delay)
  pending = { link, url, showTimer, fetchController: null, hintReadyHandler: null, hideTimer: null, element: null, maxPendingTimer: null }
}

function hoverLeave(link) {
  if (pending && pending.link === link) {
    cancelPending()
    return
  }
  if (current && current.link === link) {
    scheduleHide()
  }
}

function onShowTimerFire(link, url) {
  if (!pending || pending.link !== link) return

  const cached = hintCache.get(url)
  if (cached === NO_HINT) {
    cancelPending()
    return
  }
  if (cached) {
    showHint(link, url, cached)
    return
  }

  const isOverlayLink = !!(link.dataset.turboOverlay || link.dataset.turboStream === "true")
  const hasHintUrl    = !!link.dataset.turboOverlayHintUrl

  if (isOverlayLink && !hasHintUrl) {
    cancelPending()
    return
  }

  renderPendingHint(link)

  if (hasHintUrl) {
    fetchAndShow(link, url)
  } else if (turboWillPrefetch(link)) {
    awaitPrefetchAndShow(link, url)
  } else {
    fetchAndShow(link, url, { hintVariant: false })
  }
}

// Mirror Turbo's link-prefetch opt-out predicates so we know when to
// fall back to a manual fetch. Best-effort — Turbo may decline to
// prefetch for other reasons (cross-origin, non-GET, etc.) but
// hint_link_to already emits a same-origin GET, so the common opt-outs
// we care about are the meta and dataset switches.
function turboWillPrefetch(link) {
  const meta = document.querySelector('meta[name="turbo-prefetch"]')
  if (meta && meta.getAttribute("content") === "false") return false
  if (link.closest('[data-turbo-prefetch="false"]')) return false
  return true
}

// Clone the host app's `_loading.html+hint.erb` template into the
// body, position it like a real hint, and stash the node on `pending`
// so it tracks the in-flight request. The real hint (or silent
// dismissal) takes over via `showHint` / `cancelPending`.
function renderPendingHint(link) {
  if (!pending || pending.link !== link) return
  if (pending.element) return

  const template = document.getElementById("turbo_overlay_loading_hint_template")
  if (!template || !template.content) return

  const node = template.content.cloneNode(true).firstElementChild
  if (!node) return

  node.dataset.state = "entering"
  node.dataset.turboOverlayHintPending = "true"
  document.body.appendChild(node)

  positionFloatingHint(node, link)

  node.addEventListener("mouseenter", () => cancelHideTimer())
  node.addEventListener("mouseleave", () => scheduleHide())

  pending.element = node

  pending.maxPendingTimer = setTimeout(() => {
    if (!pending || pending.link !== link) return
    cacheFragment(pending.url, NO_HINT)
    cancelPending()
  }, MAX_PENDING_MS)

  setTimeout(() => { if (node.dataset.state === "entering") delete node.dataset.state }, 200)
}

function positionFloatingHint(node, link) {
  const dialogRect = node.getBoundingClientRect()
  const anchorRect = link.getBoundingClientRect()
  const viewport = {
    width:  document.documentElement.clientWidth,
    height: document.documentElement.clientHeight
  }
  const { top, left } = computePopoverPosition({
    anchor: anchorRect,
    dialog: dialogRect,
    viewport,
    position: "bottom",
    align: "start",
    offset: 6,
    autoFlip: true
  })
  node.style.position = "fixed"
  node.style.top  = `${top}px`
  node.style.left = `${left}px`
}

function awaitPrefetchAndShow(link, url) {
  if (!pending || pending.link !== link) return

  const ready = (event) => {
    if (!pending || pending.link !== link) return
    if (event.detail.url !== url && normalize(event.detail.url) !== normalize(url)) return
    cleanup()
    const cached = hintCache.get(url) || hintCache.get(normalize(url))
    if (cached && cached !== NO_HINT) {
      showHint(link, url, cached)
    } else {
      // Response carried no hint template (or fetch errored). Dismiss
      // the pending placeholder silently. The NO_HINT cache entry
      // stops the next hover from painting a placeholder.
      cancelPending()
    }
  }
  const cleanup = () => {
    document.removeEventListener("turbo-overlay:hint-ready", ready)
    if (pending) {
      pending.hintReadyHandler = null
    }
  }

  pending.hintReadyHandler = ready
  document.addEventListener("turbo-overlay:hint-ready", ready)
  // No fixed timeout: the pending placeholder keeps spinning until the
  // prefetch response arrives (success → swap; no-template → dismiss),
  // the user hovers away (`hoverLeave` → `cancelPending`), or the page
  // navigates / clicks (`onTurboVisit` / `onTurboClick`). A slow
  // controller (eg. heavy DB query) reliably wins this race;
  // previously a 750ms budget killed the placeholder before the
  // response landed.
}

async function fetchAndShow(link, url, { hintVariant = true } = {}) {
  if (!pending || pending.link !== link) return

  const controller = new AbortController()
  pending.fetchController = controller

  // Two callers:
  //   - hint_url: links (hintVariant=true) — send X-Turbo-Overlay: hint
  //     so the server can render `show.html+hint.erb` or similar.
  //   - prefetch-disabled fallback (hintVariant=false) — fetch the
  //     plain page and extract the `<template id="turbo-overlay-hint">`
  //     that `overlay_stack_tag` emitted for the action's `+hint`
  //     variant, matching what Turbo prefetch would have delivered.
  const headers = { "Accept": "text/html" }
  if (hintVariant) headers["X-Turbo-Overlay"] = "hint"

  let response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      cache: "default",
      headers: headers,
      credentials: "same-origin"
    })
  } catch (e) {
    // AbortError lands here when `cancelPending` aborted us — pending
    // is already null. Don't cache abort as NO_HINT; it might succeed
    // next time.
    if (e && e.name !== "AbortError") cacheFragment(url, NO_HINT)
    if (pending && pending.link === link) cancelPending()
    return
  }

  if (!pending || pending.link !== link) return
  if (!response || !response.ok) {
    cacheFragment(url, NO_HINT)
    cancelPending()
    return
  }

  let fragment
  try {
    fragment = await extractHintFragment(response, readConfig().templateId)
  } catch (_) {
    cacheFragment(url, NO_HINT)
    cancelPending()
    return
  }
  if (!fragment) {
    cacheFragment(url, NO_HINT)
    cancelPending()
    return
  }

  cacheFragment(url, fragment)
  if (response.url && response.url !== url) cacheFragment(response.url, fragment)

  if (pending && pending.link === link) {
    showHint(link, url, fragment)
  }
}

// ----- show / hide -----

function showHint(link, url, fragment) {
  // If a pending placeholder for the same link is on screen, transfer
  // it through `current` so the standard dismissal removes it
  // synchronously (no fade) right before the real hint mounts —
  // avoids a visible out/in flicker.
  if (pending && pending.element && pending.link === link) {
    current = { link, url, element: pending.element, hideTimer: null }
    pending.element = null
  }

  dismissCurrent({ animate: false })
  cancelPending()

  const node = fragment.cloneNode(true).firstElementChild
  if (!node) return

  node.dataset.state = "entering"
  document.body.appendChild(node)

  positionFloatingHint(node, link)

  const hintId = node.id || `turbo-overlay-hint-${Math.random().toString(36).slice(2, 10)}`
  node.id = hintId
  previousAriaDescribedBy = link.getAttribute("aria-describedby")
  link.setAttribute("aria-describedby", hintId)

  node.addEventListener("mouseenter", () => cancelHideTimer())
  node.addEventListener("mouseleave", () => scheduleHide())

  current = { link, url, element: node, hideTimer: null }

  setTimeout(() => { if (node.dataset.state === "entering") delete node.dataset.state }, 200)

  document.dispatchEvent(new CustomEvent("turbo-overlay:hint-shown", {
    detail: { url }
  }))
}

function scheduleHide() {
  cancelHideTimer()
  const delay = readConfig().hideDelay
  if (current) {
    current.hideTimer = setTimeout(() => dismissCurrent(), delay)
  } else if (pending && pending.element) {
    // Pending placeholder visible but the user has hovered away —
    // dismiss after the same grace window so brief cursor excursions
    // don't kill in-flight requests.
    pending.hideTimer = setTimeout(() => cancelPending(), delay)
  }
}

function cancelHideTimer() {
  if (current && current.hideTimer) {
    clearTimeout(current.hideTimer)
    current.hideTimer = null
  }
  if (pending && pending.hideTimer) {
    clearTimeout(pending.hideTimer)
    pending.hideTimer = null
  }
}

function dismissCurrent({ animate = true } = {}) {
  if (!current) return
  const { link, element } = current
  cancelHideTimer()
  if (link && previousAriaDescribedBy != null) {
    link.setAttribute("aria-describedby", previousAriaDescribedBy)
  } else if (link) {
    link.removeAttribute("aria-describedby")
  }
  previousAriaDescribedBy = null
  current = null

  if (!element || !element.parentNode) return
  if (!animate) { element.remove(); return }

  element.dataset.state = "leaving"
  const onEnd = () => { element.removeEventListener("animationend", onEnd); element.remove() }
  element.addEventListener("animationend", onEnd)
  setTimeout(() => { if (element.parentNode) element.remove() }, 250)
}

function cancelPending() {
  if (!pending) return
  if (pending.showTimer)       clearTimeout(pending.showTimer)
  if (pending.hideTimer)       clearTimeout(pending.hideTimer)
  if (pending.maxPendingTimer) clearTimeout(pending.maxPendingTimer)
  if (pending.hintReadyHandler) {
    document.removeEventListener("turbo-overlay:hint-ready", pending.hintReadyHandler)
  }
  if (pending.fetchController) {
    try { pending.fetchController.abort() } catch (_) { /* ignore */ }
  }
  if (pending.element && pending.element.parentNode) {
    const el = pending.element
    el.dataset.state = "leaving"
    const onEnd = () => { el.removeEventListener("animationend", onEnd); el.remove() }
    el.addEventListener("animationend", onEnd)
    setTimeout(() => { if (el.parentNode) el.remove() }, 250)
  }
  pending = null
}

// ----- cache -----

function cacheFragment(url, fragment) {
  if (!hintCache.has(url) && hintCache.size >= CACHE_LIMIT) {
    const oldestKey = hintCache.keys().next().value
    hintCache.delete(oldestKey)
  }
  hintCache.set(url, fragment)
}

function normalize(url) {
  try { return new URL(url, document.baseURI).toString() } catch (_) { return url }
}

// ----- helpers -----

function closestHintLink(target) {
  if (!target || !target.closest) return null
  return target.closest("a[data-turbo-overlay-hint]")
}

function anyHintLinkMatches(url) {
  const normalized = normalize(url)
  const links = document.querySelectorAll("a[data-turbo-overlay-hint]")
  for (const link of links) {
    const linkHref = normalize(link.dataset.turboOverlayHintUrl || link.href || "")
    if (linkHref === normalized) return true
  }
  return false
}

// Shared extractor — feeds from a single code path regardless of
// whether the response was a Turbo prefetch or our own hint_url fetch.
async function extractHintFragment(response) {
  const html = await response.clone().text()
  const doc  = new DOMParser().parseFromString(html, "text/html")
  const tpl  = doc.querySelector(`template#${cssEscape(TEMPLATE_ID)}`)
  return tpl ? tpl.content.cloneNode(true) : null
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
}

function setup() {
  if (typeof document === "undefined") return
  if (window._turboOverlayHintRegistered) return
  window._turboOverlayHintRegistered = true

  document.addEventListener("mouseover", onMouseOver)
  document.addEventListener("mouseout",  onMouseOut)
  document.addEventListener("focusin",   onFocusIn)
  document.addEventListener("focusout",  onFocusOut)
  document.addEventListener("keydown",   onKeyDown)
  document.addEventListener("turbo:before-fetch-response", onTurboFetchResp)
  document.addEventListener("turbo:fetch-request-error",   onTurboFetchError)
  document.addEventListener("turbo:visit", onTurboVisit)
  document.addEventListener("turbo:click", onTurboClick)
}

setup()
