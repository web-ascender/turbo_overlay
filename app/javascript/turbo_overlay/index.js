import "turbo_overlay/setup"
import { registerConfirm } from "turbo_overlay/setup"
import StackController from "turbo_overlay/stack_controller"
import OverlayController from "turbo_overlay/overlay_controller"
import HintController from "turbo_overlay/hint_controller"

// Single entry point for the gem's Stimulus controllers.
//
//   import { register } from "turbo_overlay"
//   register(application)
//
// Registers three controllers under their canonical identifiers:
// `turbo-overlay-stack`, `turbo-overlay`, and `turbo-overlay-hint`.
//
// Importing this module also runs `turbo_overlay/setup`, which
// installs the page-level wiring (request-header injection, loading
// placeholders, back/forward cache teardown, the
// `turbo_stream.overlay` custom stream action). That setup is
// idempotent — guarded by `window._turboOverlay*Registered` flags —
// so it's safe to import this entry point more than once.
//
// Pass `{ confirm: true }` to also route `data-turbo-confirm` on
// links/forms through the gem's themed overlay instead of the
// browser-native `window.confirm`. Requires confirm chrome partials
// in `app/views/turbo_overlay/` (copied by `turbo_overlay:install`);
// falls back to native `confirm` if no variant partial is present.
//
//   register(application, { confirm: true })
//
// The hint controller is registered unconditionally — it's inert
// without `data-turbo-overlay-hint` markers on links, so it's free
// for apps that don't use hover hints. Disable globally via
// `TurboOverlay.configuration.hint.enabled = false`, which makes
// `overlay_stack_tag` skip the `turbo-overlay-hint` data-controller
// entry.
export function register(application, options = {}) {
  application.register("turbo-overlay-stack", StackController)
  application.register("turbo-overlay", OverlayController)
  application.register("turbo-overlay-hint", HintController)
  if (options.confirm) registerConfirm()
}

export { StackController, OverlayController, HintController, registerConfirm }
