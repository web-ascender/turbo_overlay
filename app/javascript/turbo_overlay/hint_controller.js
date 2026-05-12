import { Controller } from "@hotwired/stimulus"
import { computePopoverPosition } from "turbo_overlay/popover_position"

// Hover-triggered hint previews for turbo_overlay.
//
// Mounted alongside turbo-overlay-stack on the host-page stack
// container (`<%= overlay_stack_tag %>`). Uses delegated document
// listeners so it doesn't need a controller per link.
//
// Two content sources, one extraction path:
//
//   1. Turbo's hover prefetch (for plain links). FetchRequest
//      dispatches `turbo:before-fetch-response` for every fetch
//      including prefetch; we listen, extract a `<template id="…">`
//      from the response, and cache the fragment by URL.
//
//   2. Explicit `hint_url:` (for overlay links Turbo refuses to
//      prefetch — modal/drawer/popover_link_to set data-turbo-stream
//      which excludes them from hover prefetch). The controller
//      fetches the hint URL with the `:hint` request variant on
//      hover and extracts the same `<template id="…">` shape.
//
// Both producers emit:
//
//   <template id="turbo-overlay-hint">
//     <div class="turbo-overlay-hint" role="tooltip">...body...</div>
//   </template>
//
// so the JS extractor doesn't branch on source.

const FETCH_WAIT_BUDGET_MS = 750
const CACHE_LIMIT = 50

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
    this._onTurboVisit       = this._onTurboVisit.bind(this)
    this._onTurboClick       = this._onTurboClick.bind(this)

    document.addEventListener("mouseover", this._onMouseOver)
    document.addEventListener("mouseout",  this._onMouseOut)
    document.addEventListener("focusin",   this._onFocusIn)
    document.addEventListener("focusout",  this._onFocusOut)
    document.addEventListener("keydown",   this._onKeyDown)
    document.addEventListener("turbo:before-fetch-response", this._onTurboFetchResp)
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
    // Moving cursor into the rendered hint should not dismiss.
    if (this.current && this.current.element && moveTo && this.current.element.contains(moveTo)) return
    this._hoverLeave(link)
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

    let fragment
    try {
      fragment = await extractHintFragment(response, this.templateIdValue)
    } catch (_) {
      return
    }
    if (!fragment) return

    this._cacheFragment(requestUrl, fragment)
    if (response.url && response.url !== requestUrl) this._cacheFragment(response.url, fragment)

    document.dispatchEvent(new CustomEvent("turbo-overlay:hint-ready", {
      detail: { url: requestUrl }
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
    if (this.pending && this.pending.link === link) return

    const url = link.dataset.turboOverlayHintUrl || link.href
    if (!url) return

    const showTimer = setTimeout(() => this._onShowTimerFire(link, url), this.showDelayValue)
    this.pending = { link, url, showTimer, fetchController: null, awaitTimer: null, hintReadyHandler: null }
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
    if (cached) {
      this._showHint(link, url, cached)
      return
    }

    const isOverlayLink = !!(link.dataset.turboOverlay || link.dataset.turboStream === "true")
    const hasHintUrl    = !!link.dataset.turboOverlayHintUrl

    if (hasHintUrl) {
      this._fetchAndShow(link, url)
    } else if (isOverlayLink) {
      // Turbo doesn't prefetch overlay-marked links and no hint_url
      // was provided. Nothing to wait for.
      this._cancelPending()
    } else {
      this._awaitPrefetchAndShow(link, url)
    }
  }

  _awaitPrefetchAndShow(link, url) {
    if (!this.pending || this.pending.link !== link) return

    const ready = (event) => {
      if (!this.pending || this.pending.link !== link) return
      if (event.detail.url !== url && this._normalize(event.detail.url) !== this._normalize(url)) return
      cleanup()
      const fragment = this.hintCache.get(url) || this.hintCache.get(this._normalize(url))
      if (fragment) this._showHint(link, url, fragment)
    }
    const cleanup = () => {
      document.removeEventListener("turbo-overlay:hint-ready", ready)
      if (this.pending) {
        clearTimeout(this.pending.awaitTimer)
        this.pending.hintReadyHandler = null
        this.pending.awaitTimer = null
      }
    }

    this.pending.hintReadyHandler = ready
    document.addEventListener("turbo-overlay:hint-ready", ready)
    this.pending.awaitTimer = setTimeout(() => {
      cleanup()
      // Silent give-up: no prefetch arrived in time and no hint_url to fall back on.
      if (this.pending && this.pending.link === link) this._cancelPending()
    }, FETCH_WAIT_BUDGET_MS)
  }

  async _fetchAndShow(link, url) {
    if (!this.pending || this.pending.link !== link) return

    const controller = new AbortController()
    this.pending.fetchController = controller

    let response
    try {
      response = await fetch(url, {
        signal: controller.signal,
        cache: "default",
        headers: { "X-Turbo-Overlay": "hint", "Accept": "text/html" },
        credentials: "same-origin"
      })
    } catch (_) {
      return
    }

    if (!this.pending || this.pending.link !== link) return
    if (!response || !response.ok) { this._cancelPending(); return }

    let fragment
    try {
      fragment = await extractHintFragment(response, this.templateIdValue)
    } catch (_) {
      this._cancelPending()
      return
    }
    if (!fragment) { this._cancelPending(); return }

    this._cacheFragment(url, fragment)
    if (response.url && response.url !== url) this._cacheFragment(response.url, fragment)

    if (this.pending && this.pending.link === link) {
      this._showHint(link, url, fragment)
    }
  }

  // ----- show / hide -----

  _showHint(link, url, fragment) {
    this._dismissCurrent({ animate: false })
    this._cancelPending()

    const node = fragment.cloneNode(true).firstElementChild
    if (!node) return

    node.dataset.state = "entering"
    document.body.appendChild(node)

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
    if (!this.current) return
    this._cancelHideTimer()
    this.current.hideTimer = setTimeout(() => this._dismissCurrent(), this.hideDelayValue)
  }

  _cancelHideTimer() {
    if (this.current && this.current.hideTimer) {
      clearTimeout(this.current.hideTimer)
      this.current.hideTimer = null
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
    if (this.pending.showTimer)   clearTimeout(this.pending.showTimer)
    if (this.pending.awaitTimer)  clearTimeout(this.pending.awaitTimer)
    if (this.pending.hintReadyHandler) {
      document.removeEventListener("turbo-overlay:hint-ready", this.pending.hintReadyHandler)
    }
    if (this.pending.fetchController) {
      try { this.pending.fetchController.abort() } catch (_) { /* ignore */ }
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
