import StackController from "turbo_overlay/stack_controller"
import OverlayController from "turbo_overlay/overlay_controller"

// Single entry point for the gem's Stimulus controllers.
//
//   import { register } from "turbo_overlay"
//   register(application)
//
// Registers both controllers under their canonical identifiers
// (`turbo-overlay-stack` and `turbo-overlay`).
export function register(application) {
  application.register("turbo-overlay-stack", StackController)
  application.register("turbo-overlay", OverlayController)
}

export { StackController, OverlayController }
