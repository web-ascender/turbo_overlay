# Third-party form widgets inside overlays

Form widgets that float a dropdown, calendar, or menu need three
things to work cleanly inside an overlay:

1. Their floating UI must render where the user can see and click it.
2. They must initialize after the input enters the DOM, and again
   after a validation re-render.
3. Outside-click dismissal in the overlay must not eat clicks on the
   widget's floating UI.

Modals add a fourth: the native `<dialog>` top layer makes
body-portaled elements invisible behind the modal unless you keep
the widget's floater out of `<body>`.

## Per-library defaults

What each library does out of the box (verified against current
upstream docs):

| Library      | Default mount point of floating UI | Modal-safe out of the box? |
|--------------|------------------------------------|----------------------------|
| Tom Select   | inside the control wrapper         | **yes** — no config needed |
| flatpickr    | appended to `document.body`        | no — set `static: true`    |
| Select2      | appended to `document.body`        | no — set `dropdownParent`  |
| Tippy.js     | `appendTo: () => document.body`    | no — set `appendTo: "parent"` (or use the allowlist for popovers) |

Two recovery strategies, depending on overlay type:

- **Modals.** Native `<dialog>.showModal()` renders the dialog in the
  browser's top layer, painted above every other element regardless
  of `z-index`. A widget that appends its floater to `<body>` ends up
  *behind* the modal. The fix is to keep the floater out of `<body>`
  using the library's own option (recipes below). The
  `allowed_click_outside_selectors` allowlist does **not** rescue
  this — even if dismissal is suppressed, the floater is still
  invisible behind the modal.

- **Drawers and popovers.** Both open with `show()` /
  `showPopover()`, not `showModal()`, so they don't take over the
  top layer. Body-portaled floaters render above them correctly —
  the only remaining issue is that the popover's outside-click
  handler treats a click on the floater as a dismissal. That's what
  the allowlist is for. See [reference](reference.md#configuration).

## Per-library recipes

### Tom Select

```js
new TomSelect(element, { /* no portal config needed */ })
```

Tom Select's `dropdownParent` is `null` by default — the dropdown
renders as a child of the control wrapper, which lives inside the
dialog. It already inherits the modal's top-layer rendering context
and its click target is inside the dialog, so neither a parent
override nor the allowlist is required.

**Do not** set `dropdownParent` to the dialog. Tom Select computes
dropdown offsets relative to the parent you supply; pointing it at
the dialog node mis-positions the panel because the dialog itself
is centered by the top-layer UA stylesheet.

### flatpickr

```js
flatpickr(input, { static: true })
```

flatpickr's default behavior is to append the calendar to
`document.body`. The `static: true` option mounts the calendar
inside the input's wrapper instead, which keeps it in the dialog
and in the top layer.

Alternative: `appendTo: input.closest("dialog")` if `static` doesn't
suit the visual layout (e.g., narrow drawers where the calendar
would clip).

### Select2

```js
$(input).select2({ dropdownParent: $(input).closest("dialog") })
```

Select2 appends its dropdown to the document body by default. The
upstream docs flag this explicitly: *"This is useful when attempting
to render Select2 correctly inside of modals and other small
containers."* Compute `dropdownParent` relative to the input so the
same initialization works inside any overlay type.

### Tippy.js (and other Popper-based libraries)

```js
tippy(button, { appendTo: "parent" })
```

Tippy's default is `appendTo: () => document.body`. Setting
`"parent"` mounts the tooltip in the trigger's parentNode, which is
inside the dialog. If you need the tooltip outside its parent for
overflow reasons but still inside a modal, pass a dialog reference:

```js
tippy(button, { appendTo: button.closest("dialog") || document.body })
```

For popovers (which aren't in the top layer), the simpler path is
to leave Tippy at its default and add `.tippy-box` to
`allowed_click_outside_selectors` so popover dismissal ignores
clicks inside Tippy's tooltip.

## Initializing on overlay open

Overlay content enters the DOM lazily — the input doesn't exist
until the overlay opens. Two reliable patterns:

### Stimulus controller (recommended)

Wrap the widget in a Stimulus controller scoped to the input. The
controller connects when the input enters the DOM (overlay open) and
reconnects when the dialog is morphed on a validation re-render —
no overlay-specific code required:

```js
// app/javascript/controllers/tom_select_controller.js
import { Controller } from "@hotwired/stimulus"
import TomSelect from "tom-select"

export default class extends Controller {
  connect() {
    this.instance = new TomSelect(this.element)
  }
  disconnect() {
    this.instance?.destroy()
  }
}
```

```erb
<%= form.select :country, options, {}, data: { controller: "tom-select" } %>
```

Teardown is automatic when the dialog closes or re-renders.

### Listen for `turbo-overlay:shown`

When Stimulus isn't an option, the gem fires `turbo-overlay:shown`
on the dialog (bubbling) once it's open and interactive:

```js
document.addEventListener("turbo-overlay:shown", (event) => {
  const dialog = event.target
  dialog.querySelectorAll("[data-flatpickr]").forEach((el) => {
    if (el._fp) return                          // idempotent
    el._fp = flatpickr(el, { static: true })
  })
})

document.addEventListener("turbo-overlay:before-close", (event) => {
  event.target.querySelectorAll("[data-flatpickr]").forEach((el) => {
    el._fp?.destroy()
    el._fp = null
  })
})
```

The dialog node is replaced on form re-render (validation failure),
so the listener must be idempotent or keyed off a marker attribute.

## Why we don't ship per-library Stimulus controllers

Each upstream library has its own initialization API, teardown
semantics, version-to-version churn, and integration quirks
(Tom Select's `revertOnDestroy`, flatpickr's `altInput` shadow
inputs, Select2's jQuery dependency). Owning that here would couple
the gem to versions of libraries it has no other reason to know
about. The patterns above are short enough to keep in the host app,
and using them keeps the integration legible from the host app's
perspective.
