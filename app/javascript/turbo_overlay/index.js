import StackController, { registerConfirm } from "turbo_overlay/stack_controller"
import OverlayController from "turbo_overlay/overlay_controller"

// Single entry point for the gem's Stimulus controllers.
//
//   import { register } from "turbo_overlay"
//   register(application)
//
// Registers both controllers under their canonical identifiers
// (`turbo-overlay-stack` and `turbo-overlay`).
//
// Pass `{ confirm: true }` to also route `data-turbo-confirm` on
// links/forms through the gem's themed modal instead of the
// browser-native `window.confirm`. Requires
// `app/views/turbo_overlay/_confirm.html.erb` (copied by
// `turbo_overlay:install`); falls back to native `confirm` if the
// partial is absent.
//
//   register(application, { confirm: true })
export function register(application, options = {}) {
  application.register("turbo-overlay-stack", StackController)
  application.register("turbo-overlay", OverlayController)
  if (options.confirm) registerConfirm()
}

export { StackController, OverlayController, registerConfirm }
