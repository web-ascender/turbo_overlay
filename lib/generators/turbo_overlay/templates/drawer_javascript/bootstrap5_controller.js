import { Controller } from "@hotwired/stimulus"

// Bootstrap 5's `bootstrap` global must be available — typically via
// `import * as bootstrap from "bootstrap"` followed by
// `window.bootstrap = bootstrap`, or via CDN.
function registerStreamAction() {
  if (typeof window === "undefined") return
  const Turbo = window.Turbo
  if (!Turbo || !Turbo.StreamActions || Turbo.StreamActions.overlay) return

  Turbo.StreamActions.overlay = function () {
    const message = this.getAttribute("message") || "close"
    window.dispatchEvent(new CustomEvent(`turbo-overlay:${message}`))
  }
}
registerStreamAction()

export default class extends Controller {
  connect() {
    registerStreamAction()

    if (typeof window.bootstrap === "undefined") {
      console.warn("[turbo-drawer] Bootstrap 5 JS not found on window.bootstrap; drawer will not auto-open.")
      return
    }

    this.offcanvas = window.bootstrap.Offcanvas.getOrCreateInstance(this.element)
    this.offcanvas.show()
  }

  disconnect() {
    // Frame is being emptied or page is changing. Bootstrap's hide()
    // also cleans up the backdrop on body even if the offcanvas
    // element is detached.
    if (this.offcanvas) this.offcanvas.hide()
  }

  // data-action="click->turbo-drawer#close"
  // data-action="turbo-overlay:close@window->turbo-drawer#close"
  close(event) {
    if (event) event.preventDefault()
    if (this.offcanvas) this.offcanvas.hide()
  }
}
