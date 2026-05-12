import { Controller } from "@hotwired/stimulus"
import { computePopoverPosition } from "turbo_overlay/popover_position"

// Hover-triggered hint previews for turbo_overlay.
//
// Mounted alongside turbo-overlay-stack on the host-page stack
// container (`<%= overlay_stack_tag %>`). Uses delegated document
// listeners so it doesn't need a controller per link.
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
//      Turbo won't fire a prefetch for us. The controller falls back
//      to a plain `fetch()` of the link's href so hints still work.
//
//   3. Explicit `hint_url:` (for overlay links Turbo refuses to
//      prefetch — modal/drawer/popover_link_to set data-turbo-stream
//      which excludes them from hover prefetch). The controller
//      fetches the hint URL with the `:hint` request variant on
//      hover and extracts the same `<template id="…">` shape.
//
// All three producers emit:
//
//   <template id="turbo-overlay-hint">
//     <div class="turbo-overlay-hint" role="tooltip">...body...</div>
//   </template>
//
// so the JS extractor doesn't branch on source.
//
// Detection is best-effort: we mirror Turbo's two common opt-out
// switches (meta and dataset). Other reasons Turbo might decline
// (cross-origin, non-GET, etc.) aren't relevant for `hint_link_to`,
// which always emits a same-origin GET.

const CACHE_LIMIT = 50

// Safety-net cap on how long the pending placeholder can spin before
// we give up. The happy path resolves via `hint-ready` (fetch
// success) or `fetch-request-error` (network failure). This catches
// the cases where neither fires: Turbo silently cancelling a queued
// prefetch, an indefinitely-hung server, or a browser that swallows
// the fetch event lifecycle. Cached as NO_HINT so a retry only
// happens after the next page visit.
const MAX_PENDING_MS = 10000

// Sentinel cached against a URL that we know has no hint template
// (or whose prefetch failed). Distinguishes "fetched and confirmed
// empty" from "never fetched", so we (a) don't paint a pending
// placeholder for a link we've already confirmed has nothing to show
// and (b) dismiss any in-flight pending immediately if the response
// already arrived during the show_delay window.
const NO_HINT = Symbol("turbo-overlay-no-hint")

export default class extends Controller {
  static values = {
    enabled:    { type: Boolean, default: true },
    showDelay:  { type: Number,  default: 250 },
    hideDelay:  { type: Number,  default: 120 },
    templateId: { type: String,  default: "turbo-overlay-hint" }
  }

  connect() {
    if (!this.enabledValue) return
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return

    this.hintCache = new Map()
    this.current   = null    // { link, url, element }
    this.pending   = null    // { link, url, showTimer, fetchController, awaitTimer, hintReadyHandler }

    this._onMouseOver        = this._onMouseOver.bind(this)
    this._onMouseOut         = this._onMouseOut.bind(this)
    this._onFocusIn          = this._onFocusIn.bind(this)
    this._onFocusOut         = this._onFocusOut.bind(this)
    this._onKeyDown          = this._onKeyDown.bind(this)
    this._onTurboFetchResp   = this._onTurboFetchResp.bind(this)
    this._onTurboFetchError  = this._onTurboFetchError.bind(this)
    this._onTurboVisit       = this._onTurboVisit.bind(this)
    this._onTurboClick       = this._onTurboClick.bind(this)

    document.addEventListener("mouseover", this._onMouseOver)
    document.addEventListener("mouseout",  this._onMouseOut)
    document.addEventListener("focusin",   this._onFocusIn)
    document.addEventListener("focusout",  this._onFocusOut)
    document.addEventListener("keydown",   this._onKeyDown)
    document.addEventListener("turbo:before-fetch-response", this._onTurboFetchResp)
    document.addEventListener("turbo:fetch-request-error",   this._onTurboFetchError)
    document.addEventListener("turbo:visit", this._onTurboVisit)
    document.addEventListener("turbo:click", this._onTurboClick)
  }

  disconnect() {
    document.removeEventListener("mouseover", this._onMouseOver)
    document.removeEventListener("mouseout",  this._onMouseOut)
    document.removeEventListener("focusin",   this._onFocusIn)
    document.removeEventListener("focusout",  this._onFocusOut)
    document.removeEventListener("keydown",   this._onKeyDown)
    document.removeEventListener("turbo:before-fetch-response", this._onTurboFetchResp)
    document.removeEventListener("turbo:fetch-request-error",   this._onTurboFetchError)
    document.removeEventListener("turbo:visit", this._onTurboVisit)
    document.removeEventListener("turbo:click", this._onTurboClick)

    this._cancelPending()
    this._dismissCurrent({ animate: false })
    if (this.hintCache) this.hintCache.clear()
  }

  // ----- event handlers -----

  _onMouseOver(event) {
    const link = this._closestHintLink(event.target)
    if (!link) return
    this._hoverEnter(link)
  }

  _onMouseOut(event) {
    const link = this._closestHintLink(event.target)
    if (!link) return
    const moveTo = event.relatedTarget
    if (moveTo && link.contains(moveTo)) return
    // Moving cursor into the rendered hint (real or pending) should
    // not dismiss.
    const active = this._activeHintElement()
    if (active && moveTo && active.contains(moveTo)) return
    this._hoverLeave(link)
  }

  _activeHintElement() {
    if (this.current && this.current.element) return this.current.element
    if (this.pending && this.pending.element) return this.pending.element
    return null
  }

  _onFocusIn(event) {
    const link = this._closestHintLink(event.target)
    if (!link) return
    this._hoverEnter(link)
  }

  _onFocusOut(event) {
    const link = this._closestHintLink(event.target)
    if (!link) return
    this._hoverLeave(link)
  }

  _onKeyDown(event) {
    if (event.key === "Escape" && this.current) {
      this._dismissCurrent()
    }
  }

  _onTurboVisit() {
    if (this.hintCache) this.hintCache.clear()
    this._cancelPending()
    this._dismissCurrent({ animate: false })
  }

  _onTurboClick() {
    this._cancelPending()
  }

  // FetchRequest dispatches before-fetch-response for every fetch
  // (navigation, prefetch, preload, form). For any response whose
  // request URL matches a hint-marked link in the DOM, parse the
  // body for a hint template and cache the fragment.
  async _onTurboFetchResp(event) {
    const detail = event.detail || {}
    const response = detail.fetchResponse && detail.fetchResponse.response
    if (!response) return

    const requestUrl = response.url || (detail.url && detail.url.toString())
    if (!requestUrl) return

    if (!this._anyHintLinkMatches(requestUrl)) return

    let fragment = null
    if (response.ok) {
      try {
        fragment = await extractHintFragment(response, this.templateIdValue)
      } catch (_) {
        fragment = null
      }
    }

    // Cache both outcomes:
    //   - fragment: future hovers show instantly from cache
    //   - NO_HINT: future hovers skip the pending placeholder
    //     entirely and dismiss the show timer silently
    const value = fragment || NO_HINT
    this._cacheFragment(requestUrl, value)
    if (response.url && response.url !== requestUrl) this._cacheFragment(response.url, value)

    document.dispatchEvent(new CustomEvent("turbo-overlay:hint-ready", {
      detail: { url: requestUrl, fragment: fragment }
    }))
  }

  _onTurboFetchError(event) {
    const detail = event.detail || {}
    const request = detail.request || detail.fetchRequest
    if (!request) return
    const requestUrl = request.url && (typeof request.url.toString === "function" ? request.url.toString() : String(request.url))
    if (!requestUrl) return
    if (!this._anyHintLinkMatches(requestUrl)) return

    // Network failure for a hint-marked URL. Treat as "no hint" so
    // we don't strand a pending spinner and don't retry on the next
    // hover until the next page visit clears the cache.
    this._cacheFragment(requestUrl, NO_HINT)

    document.dispatchEvent(new CustomEvent("turbo-overlay:hint-ready", {
      detail: { url: requestUrl, fragment: null }
    }))
  }

  // ----- hover state machine -----

  _hoverEnter(link) {
    // Already showing this link's hint — cancel any pending dismissal.
    if (this.current && this.current.link === link) {
      this._cancelHideTimer()
      return
    }

    // Switching to a different link — drop the prior pending state.
    if (this.pending && this.pending.link !== link) this._cancelPending()
    // Same-link rehover while pending: cancel any pending-element
    // dismissal but don't restart the show timer.
    if (this.pending && this.pending.link === link) {
      this._cancelHideTimer()
      return
    }

    const url = link.dataset.turboOverlayHintUrl || link.href
    if (!url) return

    const showTimer = setTimeout(() => this._onShowTimerFire(link, url), this.showDelayValue)
    this.pending = { link, url, showTimer, fetchController: null, hintReadyHandler: null, hideTimer: null, element: null, maxPendingTimer: null }
  }

  _hoverLeave(link) {
    // Pending hover that never showed — cancel.
    if (this.pending && this.pending.link === link) {
      this._cancelPending()
      return
    }
    // Already showing — schedule dismissal with a grace window.
    if (this.current && this.current.link === link) {
      this._scheduleHide()
    }
  }

  _onShowTimerFire(link, url) {
    if (!this.pending || this.pending.link !== link) return

    const cached = this.hintCache.get(url)
    if (cached === NO_HINT) {
      // We've already confirmed this URL has no hint (response had
      // no `<template id>` or the prefetch errored). Don't paint a
      // pending placeholder we'd just dismiss.
      this._cancelPending()
      return
    }
    if (cached) {
      this._showHint(link, url, cached)
      return
    }

    const isOverlayLink = !!(link.dataset.turboOverlay || link.dataset.turboStream === "true")
    const hasHintUrl    = !!link.dataset.turboOverlayHintUrl

    if (isOverlayLink && !hasHintUrl) {
      // Turbo doesn't prefetch overlay-marked links and no hint_url
      // was provided. Nothing to wait for; no pending state either.
      this._cancelPending()
      return
    }

    // Show a pending hint right away so the user has feedback while
    // the real content is still in flight (prefetch slower than
    // show_delay, or our explicit hint_url fetch hasn't returned yet).
    this._renderPendingHint(link)

    if (hasHintUrl) {
      this._fetchAndShow(link, url)
    } else if (this._turboWillPrefetch(link)) {
      this._awaitPrefetchAndShow(link, url)
    } else {
      // Turbo prefetch is off for this link (global meta opt-out or
      // `data-turbo-prefetch="false"` on the link / an ancestor).
      // Fetch the URL ourselves with the same shape Turbo would have
      // used so the gem still works on prefetch-disabled sites.
      this._fetchAndShow(link, url, { hintVariant: false })
    }
  }

  // Mirror Turbo's link-prefetch opt-out predicates so we know when
  // to fall back to a manual fetch. Best-effort — Turbo may decline
  // to prefetch for other reasons (cross-origin, non-GET, etc.) but
  // hint_link_to already emits a same-origin GET, so the common
  // opt-outs we care about are the meta and dataset switches.
  _turboWillPrefetch(link) {
    const meta = document.querySelector('meta[name="turbo-prefetch"]')
    if (meta && meta.getAttribute("content") === "false") return false
    if (link.closest('[data-turbo-prefetch="false"]')) return false
    // data-turbo-stream links are already routed via hint_url; this
    // branch is only reached for plain hint_link_to.
    return true
  }

  // Clone the host app's `_loading.html+hint.erb` template into the
  // body, position it like a real hint, and stash the node on
  // `this.pending` so it tracks the in-flight request. The real hint
  // (or silent dismissal) takes over via `_showHint` / `_cancelPending`.
  _renderPendingHint(link) {
    if (!this.pending || this.pending.link !== link) return
    // Belt-and-suspenders: don't paint a second pending bubble.
    if (this.pending.element) return

    const template = document.getElementById("turbo_overlay_loading_hint_template")
    if (!template || !template.content) return

    const node = template.content.cloneNode(true).firstElementChild
    if (!node) return

    node.dataset.state = "entering"
    node.dataset.turboOverlayHintPending = "true"
    document.body.appendChild(node)

    this._positionFloatingHint(node, link)

    node.addEventListener("mouseenter", () => this._cancelHideTimer())
    node.addEventListener("mouseleave", () => this._scheduleHide())

    this.pending.element = node

    // Safety net: if no hint-ready / fetch-error event fires within
    // MAX_PENDING_MS (silently cancelled prefetch, hung server, etc.),
    // dismiss the placeholder and cache NO_HINT so the next hover
    // doesn't strand a new one.
    this.pending.maxPendingTimer = setTimeout(() => {
      if (!this.pending || this.pending.link !== link) return
      this._cacheFragment(this.pending.url, NO_HINT)
      this._cancelPending()
    }, MAX_PENDING_MS)

    setTimeout(() => { if (node.dataset.state === "entering") delete node.dataset.state }, 200)
  }

  _positionFloatingHint(node, link) {
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

  _awaitPrefetchAndShow(link, url) {
    if (!this.pending || this.pending.link !== link) return

    const ready = (event) => {
      if (!this.pending || this.pending.link !== link) return
      if (event.detail.url !== url && this._normalize(event.detail.url) !== this._normalize(url)) return
      cleanup()
      const cached = this.hintCache.get(url) || this.hintCache.get(this._normalize(url))
      if (cached && cached !== NO_HINT) {
        this._showHint(link, url, cached)
      } else {
        // Response carried no hint template (or fetch errored).
        // Dismiss the pending placeholder silently. The NO_HINT cache
        // entry stops the next hover from painting a placeholder.
        this._cancelPending()
      }
    }
    const cleanup = () => {
      document.removeEventListener("turbo-overlay:hint-ready", ready)
      if (this.pending) {
        this.pending.hintReadyHandler = null
      }
    }

    this.pending.hintReadyHandler = ready
    document.addEventListener("turbo-overlay:hint-ready", ready)
    // No fixed timeout: the pending placeholder keeps spinning until the
    // prefetch response arrives (success → swap; no-template → dismiss),
    // the user hovers away (`_hoverLeave` → `_cancelPending`), or the
    // page navigates / clicks (`_onTurboVisit` / `_onTurboClick`).
    // A slow controller (eg. heavy DB query) reliably wins this race;
    // previously a 750ms budget killed the placeholder before the
    // response landed.
  }

  async _fetchAndShow(link, url, { hintVariant = true } = {}) {
    if (!this.pending || this.pending.link !== link) return

    const controller = new AbortController()
    this.pending.fetchController = controller

    // Two callers:
    //   - hint_url: links (hintVariant=true) — send X-Turbo-Overlay: hint
    //     so the server can render `show.html+hint.erb` or similar.
    //   - prefetch-disabled fallback (hintVariant=false) — fetch the
    //     plain page and extract the `<template id>` the host's
    //     `turbo_overlay_hint do` capture emitted, matching what
    //     Turbo prefetch would have delivered.
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
      // AbortError lands here when `_cancelPending` aborted us — pending
      // is already null. Don't cache abort as NO_HINT; it might
      // succeed next time.
      if (e && e.name !== "AbortError") this._cacheFragment(url, NO_HINT)
      if (this.pending && this.pending.link === link) this._cancelPending()
      return
    }

    if (!this.pending || this.pending.link !== link) return
    if (!response || !response.ok) {
      this._cacheFragment(url, NO_HINT)
      this._cancelPending()
      return
    }

    let fragment
    try {
      fragment = await extractHintFragment(response, this.templateIdValue)
    } catch (_) {
      this._cacheFragment(url, NO_HINT)
      this._cancelPending()
      return
    }
    if (!fragment) {
      this._cacheFragment(url, NO_HINT)
      this._cancelPending()
      return
    }

    this._cacheFragment(url, fragment)
    if (response.url && response.url !== url) this._cacheFragment(response.url, fragment)

    if (this.pending && this.pending.link === link) {
      this._showHint(link, url, fragment)
    }
  }

  // ----- show / hide -----

  _showHint(link, url, fragment) {
    // If a pending placeholder for the same link is on screen, transfer
    // it through `this.current` so the standard dismissal removes it
    // synchronously (no fade) right before the real hint mounts —
    // avoids a visible out/in flicker.
    if (this.pending && this.pending.element && this.pending.link === link) {
      this.current = { link, url, element: this.pending.element, hideTimer: null }
      this.pending.element = null
    }

    this._dismissCurrent({ animate: false })
    this._cancelPending()

    const node = fragment.cloneNode(true).firstElementChild
    if (!node) return

    node.dataset.state = "entering"
    document.body.appendChild(node)

    this._positionFloatingHint(node, link)

    // Accessibility: associate the hint with its trigger.
    const hintId = node.id || `turbo-overlay-hint-${Math.random().toString(36).slice(2, 10)}`
    node.id = hintId
    this._previousAriaDescribedBy = link.getAttribute("aria-describedby")
    link.setAttribute("aria-describedby", hintId)

    // Move-into-hint should cancel pending dismissal; mouse-leaving
    // the hint should restart the dismissal timer.
    node.addEventListener("mouseenter", () => this._cancelHideTimer())
    node.addEventListener("mouseleave", () => this._scheduleHide())

    this.current = { link, url, element: node, hideTimer: null }

    // Drop the "entering" state after the entry animation so the
    // dismiss animation doesn't conflict.
    setTimeout(() => { if (node.dataset.state === "entering") delete node.dataset.state }, 200)
  }

  _scheduleHide() {
    this._cancelHideTimer()
    if (this.current) {
      this.current.hideTimer = setTimeout(() => this._dismissCurrent(), this.hideDelayValue)
    } else if (this.pending && this.pending.element) {
      // Pending placeholder visible but the user has hovered away —
      // dismiss after the same grace window so brief cursor excursions
      // don't kill in-flight requests.
      this.pending.hideTimer = setTimeout(() => this._cancelPending(), this.hideDelayValue)
    }
  }

  _cancelHideTimer() {
    if (this.current && this.current.hideTimer) {
      clearTimeout(this.current.hideTimer)
      this.current.hideTimer = null
    }
    if (this.pending && this.pending.hideTimer) {
      clearTimeout(this.pending.hideTimer)
      this.pending.hideTimer = null
    }
  }

  _dismissCurrent({ animate = true } = {}) {
    if (!this.current) return
    const { link, element } = this.current
    this._cancelHideTimer()
    if (link && this._previousAriaDescribedBy != null) {
      link.setAttribute("aria-describedby", this._previousAriaDescribedBy)
    } else if (link) {
      link.removeAttribute("aria-describedby")
    }
    this._previousAriaDescribedBy = null
    this.current = null

    if (!element || !element.parentNode) return
    if (!animate) { element.remove(); return }

    element.dataset.state = "leaving"
    const onEnd = () => { element.removeEventListener("animationend", onEnd); element.remove() }
    element.addEventListener("animationend", onEnd)
    // Safety net so a hint stuck without animationend still cleans up.
    setTimeout(() => { if (element.parentNode) element.remove() }, 250)
  }

  _cancelPending() {
    if (!this.pending) return
    if (this.pending.showTimer)       clearTimeout(this.pending.showTimer)
    if (this.pending.hideTimer)       clearTimeout(this.pending.hideTimer)
    if (this.pending.maxPendingTimer) clearTimeout(this.pending.maxPendingTimer)
    if (this.pending.hintReadyHandler) {
      document.removeEventListener("turbo-overlay:hint-ready", this.pending.hintReadyHandler)
    }
    if (this.pending.fetchController) {
      try { this.pending.fetchController.abort() } catch (_) { /* ignore */ }
    }
    if (this.pending.element && this.pending.element.parentNode) {
      const el = this.pending.element
      el.dataset.state = "leaving"
      const onEnd = () => { el.removeEventListener("animationend", onEnd); el.remove() }
      el.addEventListener("animationend", onEnd)
      // Safety net so a hint stuck without animationend still cleans up.
      setTimeout(() => { if (el.parentNode) el.remove() }, 250)
    }
    this.pending = null
  }

  // ----- cache -----

  _cacheFragment(url, fragment) {
    if (!this.hintCache.has(url) && this.hintCache.size >= CACHE_LIMIT) {
      // FIFO eviction.
      const oldestKey = this.hintCache.keys().next().value
      this.hintCache.delete(oldestKey)
    }
    this.hintCache.set(url, fragment)
  }

  _normalize(url) {
    try { return new URL(url, document.baseURI).toString() } catch (_) { return url }
  }

  // ----- helpers -----

  _closestHintLink(target) {
    if (!target || !target.closest) return null
    return target.closest("a[data-turbo-overlay-hint]")
  }

  _anyHintLinkMatches(url) {
    const normalized = this._normalize(url)
    const links = document.querySelectorAll("a[data-turbo-overlay-hint]")
    for (const link of links) {
      const linkHref = this._normalize(link.dataset.turboOverlayHintUrl || link.href || "")
      if (linkHref === normalized) return true
    }
    return false
  }
}

// Shared extractor — feeds from a single code path regardless of
// whether the response was a Turbo prefetch or our own hint_url fetch.
async function extractHintFragment(response, templateId) {
  const html = await response.clone().text()
  const doc  = new DOMParser().parseFromString(html, "text/html")
  const tpl  = doc.querySelector(`template#${cssEscape(templateId)}`)
  return tpl ? tpl.content.cloneNode(true) : null
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value)
  // Minimal fallback for very old browsers; the gem supports modern Turbo so this is belt-and-suspenders.
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
}
