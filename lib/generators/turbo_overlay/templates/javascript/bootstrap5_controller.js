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
      console.warn("[turbo-modal] Bootstrap 5 JS not found on window.bootstrap; modal will not auto-open.")
      return
    }

    this.modal = window.bootstrap.Modal.getOrCreateInstance(this.element)
    this.modal.show()
  }

  disconnect() {
    // Frame is being emptied or the page is changing. Bootstrap's
    // hide() also cleans up the backdrop on body even if the modal
    // element is detached.
    if (this.modal) this.modal.hide()
  }

  // data-action="click->turbo-modal#close"
  // data-action="turbo-overlay:close@window->turbo-modal#close"
  close(event) {
    if (event) event.preventDefault()
    if (this.modal) this.modal.hide()
  }
}
