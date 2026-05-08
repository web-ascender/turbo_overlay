import { Controller } from "@hotwired/stimulus"

// Register the custom <turbo-stream action="overlay"> action.
// Server-side: `turbo_stream.overlay(:close)`. The action is generic
// — it dispatches `turbo-overlay:close` on window, and modal and
// drawer controllers both listen for it.
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
    this.dialog = this.element.tagName === "DIALOG"
      ? this.element
      : this.element.querySelector("dialog")

    if (this.dialog && !this.dialog.open) {
      try { this.dialog.showModal() } catch (_) { this.dialog.setAttribute("open", "") }
    }
  }

  disconnect() {
    if (this.dialog && this.dialog.open) {
      try { this.dialog.close() } catch (_) { this.dialog.removeAttribute("open") }
    }
  }

  // data-action="click->turbo-drawer#close"
  // data-action="turbo-overlay:close@window->turbo-drawer#close"
  close(event) {
    if (event) event.preventDefault()
    this.#dismiss()
  }

  // data-action="cancel->turbo-drawer#cancel" — native dialog Esc
  cancel() {
    this.#clearFrame()
  }

  #dismiss() {
    if (this.dialog && this.dialog.open) {
      try { this.dialog.close() } catch (_) { this.dialog.removeAttribute("open") }
    }
    this.#clearFrame()
  }

  #clearFrame() {
    const frame = this.element.closest("turbo-frame")
    if (frame) frame.innerHTML = ""
  }
}
