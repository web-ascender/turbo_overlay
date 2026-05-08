import { Controller } from "@hotwired/stimulus"

// Bootstrap 3 requires jQuery. The modal plugin is at $(...).modal().
// Provide jQuery on window.jQuery (or window.$) for this to work.
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

    const jq = window.jQuery || window.$
    if (!jq || typeof jq(this.element).modal !== "function") {
      console.warn("[turbo-modal] jQuery + Bootstrap 3 modal plugin not found; modal will not auto-open.")
      return
    }
    this.$el = jq(this.element)
    this.$el.modal({ show: true })
  }

  disconnect() {
    // Frame is being emptied or the page is changing. BS3's
    // `modal('hide')` cleans up the backdrop on body even if the
    // modal element is detached.
    if (this.$el) this.$el.modal("hide")
  }

  // data-action="click->turbo-modal#close"
  // data-action="turbo-overlay:close@window->turbo-modal#close"
  close(event) {
    if (event) event.preventDefault()
    if (this.$el) this.$el.modal("hide")
  }
}
