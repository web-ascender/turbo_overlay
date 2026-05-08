import { Controller } from "@hotwired/stimulus"

// Register the custom <turbo-stream action="overlay"> action.
// Server-side: `turbo_stream.overlay(:close)`.
//
// The action is generic across overlay types — it dispatches
// `turbo-overlay:close` on window, and any listening Stimulus
// controller (modal today, drawer in v0.2) handles its own dismiss.
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

// Event wiring is via `data-action` in the modal layout. The window
// listener is for the generic `turbo-overlay:close` custom event,
// which only fires when our stream action runs — no global
// turbo:submit-end listener.
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

  // data-action="click->turbo-modal#close"
  // data-action="turbo-overlay:close@window->turbo-modal#close"
  close(event) {
    if (event) event.preventDefault()
    this.#dismiss()
  }

  // data-action="cancel->turbo-modal#cancel" — native dialog Esc
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
