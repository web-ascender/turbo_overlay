import "turbo_overlay/setup"
import "turbo_overlay/hint"
import { registerConfirm } from "turbo_overlay/setup"
import StackController from "turbo_overlay/stack_controller"
import OverlayController from "turbo_overlay/overlay_controller"

// Single entry point for the gem's Stimulus controllers.
//
//   import { register } from "turbo_overlay"
//   register(application)
//
// Registers two controllers under their canonical identifiers:
// `turbo-overlay-stack` and `turbo-overlay`.
//
// Importing this module also runs `turbo_overlay/setup` (page-level
// wiring: request-header injection, loading placeholders, back/forward
// cache teardown, the `turbo_stream.overlay` custom stream action) and
// `turbo_overlay/hint` (hover-triggered preview module). Both
// self-bootstrap and are guarded by `window._turboOverlay*Registered`
// flags, so importing this entry point more than once is safe.
//
// Pass `{ confirm: true }` to also route `data-turbo-confirm` on
// links/forms through the gem's themed overlay instead of the
// browser-native `window.confirm`. Requires confirm chrome partials
// in `app/views/turbo_overlay/` (copied by `turbo_overlay:install`);
// falls back to native `confirm` if no variant partial is present.
//
//   register(application, { confirm: true })
//
// The hint module is loaded unconditionally — it's inert until a link
// carrying `data-turbo-overlay-hint` is hovered. Disable globally via
// `TurboOverlay.configuration.hint.enabled = false`, which sets
// `data-turbo-overlay-hint-enabled="false"` on the stack tag; the
// module reads that lazily and no-ops.
export function register(application, options = {}) {
  application.register("turbo-overlay-stack", StackController)
  application.register("turbo-overlay", OverlayController)
  if (options.confirm) registerConfirm()
}

export { StackController, OverlayController, registerConfirm }
