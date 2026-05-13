import { application } from "controllers/application"
import { register as registerTurboOverlay } from "turbo_overlay"

registerTurboOverlay(application, { confirm: true })
