# Changelog

## Unreleased

### Added
- **`backdrop: false` on `drawer_link_to`.** Opens the drawer non-modally (`dialog.show()` instead of `showModal()`). No backdrop, page stays scrollable and selectable, click outside is ignored. ESC still closes (synthesized via a keydown listener, since native `<dialog>` doesn't fire `cancel` in non-modal mode). Useful for inspector-style drawers where the user needs to read or copy from the host page.
- **`position:` on `drawer_link_to`.** Per-link override (`:left`, `:right`, `:top`, `:bottom`) for the configured `drawer.position` default.
- **Themed confirm dialogs.** Pass `{ confirm: true }` to `register(application, …)` and `data-turbo-confirm` on links/forms goes through the gem's themed modal instead of the browser-native `confirm()`. Body is cloned from a `<template>` rendered once into the page by `overlay_stack_tag`; falls back to `window.confirm` if the template is absent.
- **App-owned chrome partials.** Install drops `_modal.html.erb`, `_drawer.html.erb`, and `_confirm.html.erb` into `app/views/turbo_overlay/`. They're yours to edit — change classes, restyle, swap markup. Theme content scanners (Tailwind etc.) pick them up here automatically.
- **Bootstrap 3 drawer support.** Previously skipped (no native offcanvas primitive); now provided as a vanilla dialog styled with BS3 panel classes.
- **Dark-mode classes on the Tailwind theme.**
- `current_overlay_position` and `current_overlay_backdrop?` controller / view helpers, exposing the per-link overrides to overlay layouts.

### Changed
- **Single native `<dialog>` JS controller for every theme.** Bootstrap themes keep their visual classes (`.modal-dialog`, `.modal-content`, `.offcanvas-*`) but no longer require `window.bootstrap` or jQuery — the `<dialog>` element drives open/close, stacking, and focus management. One shared `overlay_controller.js` ships for everyone.
- **Animations on by default.** Modals fade/scale; drawers slide from their configured edge; backdrops fade. All honor `prefers-reduced-motion: reduce`. Close path adds a `turbo-overlay-closing` class, awaits `animationend` (with a 400ms safety timeout), then removes the dialog's turbo-frame.
- **CSS now ships as a real stylesheet asset.** Earlier in this cycle the styles moved out of the per-response payload into a `turbo_overlay_styles` view helper; that helper is gone — install now wires a `stylesheet_link_tag "turbo_overlay"` (propshaft), `*= require turbo_overlay` (sprockets), or prints the equivalent snippet for jsbundling/cssbundling apps.
- **Stimulus controllers shipped from the gem with importmap auto-pin.** Importmap apps get the `turbo_overlay` module pinned automatically; install appends `import { register } from "turbo_overlay"; register(application, { confirm: true })` to the host app's Stimulus entry. Bundler apps reference the gem's `app/javascript` directly or `eject` to copy locally.
- **Backdrop click dismisses by default.** Press ESC *or* click the dimmed area outside the dialog and the top overlay closes. Opt a specific overlay out with `data-turbo-overlay-backdrop-dismiss-value="false"`.
- **Stacked overlay links target `_top`.** A `modal_link_to` / `drawer_link_to` clicked from inside an open overlay now opens a new (stacked) overlay instead of replacing the current frame's contents.
- **Click-capture skips cmd/ctrl/shift/middle clicks** so cmd+click on an overlay link opens a new tab instead of leaking the `X-Turbo-Overlay` header onto an unrelated fetch.
- Plain modal caps its height and scrolls its body on overflow so long content doesn't push the dialog off-screen.

### Removed
- `window.bootstrap` and jQuery requirements for the Bootstrap themes.
- Per-theme overlay controllers (`{theme}_overlay_controller.js`).
- Inline `<style>` blocks from every shipped overlay layout.
- The interim `turbo_overlay_styles` view helper (superseded by the stylesheet asset).

### Fixed
- Modal/drawer link clicks no longer trigger full-page navigation when the gem's JS hook is loaded late.
- Stacked overlay close animation is now reliable across themes.

## 0.3.0

**Stacking support.** Overlays now stack: open a modal/drawer from inside another and the new one slides on top instead of replacing. Dismissing affects only the topmost overlay; the layer beneath is revealed. This is a breaking internal change — public helper *signatures* are preserved but the underlying transport, layouts, and Stimulus controllers were rewritten.

### Added
- Stacked overlays. Native `<dialog>.showModal()` stacks via the browser top layer; Bootstrap 5/3 themes manually bump z-index per stack depth.
- `turbo_stream.overlay(:close, scope: :all)` closes every open overlay; `turbo_stream.overlay(:close, id: "...")` targets one by id; `turbo_stream.overlay(:close, scope: :all, type: :modal)` closes all modals only. Default `:close` (no args) still closes the topmost.
- `modal_link_to` / `drawer_link_to` accept `overlay_id:` to set a stable id for later targeting from server code.
- `current_overlay_id` controller method (and view helper) — returns the id of the overlay being rendered, useful for `turbo_stream.overlay(:close, id: current_overlay_id)`.
- `overlay_stack_tag` view helper — emits the single host-page stack container.
- `config.stack_id` (default `"turbo_overlay_stack"`).

### Changed
- **Transport switched from turbo-frame replacement to turbo-stream append.** Each opened overlay is appended to the host-page stack container and wrapped in its own `<turbo-frame id="turbo_overlay_<type>_<id>">` for in-place form re-rendering.
- Variant detection now reads the `X-Turbo-Overlay` request header (set by the link helper's JS hook) instead of `Turbo-Frame`.
- Modal and drawer Stimulus controllers unified into one `turbo-overlay` controller per theme. `turbo-modal` / `turbo-drawer` identifiers no longer used; both are now `turbo-overlay`.
- `aria-labelledby` ids in shipped layouts now include the overlay id so stacked dialogs don't collide.
- Stream API: `turbo_stream.overlay(:close)` now means "close the top overlay." Previously it closed every overlay; in single-overlay setups this is observationally identical.

### Removed
- The dual-frame (`turbo_modal` + `turbo_drawer`) install model. `overlay_frame_tags` is retained as a deprecated alias for `overlay_stack_tag` for one minor cycle.
- Per-type Stimulus controllers (`turbo_modal_controller.js`, `turbo_drawer_controller.js`).

### Requires
- Turbo 8+ (turbo-rails 2+) for `data-turbo-stream="true"` GET request support.

### Migration from 0.2.x
1. Re-run the install generator with `--force` to overwrite the layout files and JS controllers:
   ```sh
   bin/rails g turbo_overlay:install --theme <your-theme> --force
   ```
2. In your application layout, replace `<%= overlay_frame_tags %>` with `<%= overlay_stack_tag %>`. (The old helper still works but warns.)
3. Remove the old per-type Stimulus controller files: `app/javascript/controllers/turbo_modal_controller.js` and `turbo_drawer_controller.js`.
4. If you customized the modal/drawer layouts, port your changes to the new layout primitives — note the wrapping helper changed from `turbo_frame_tag` to `overlay_response_wrapper(:modal|:drawer)`, the Stimulus identifier changed from `turbo-modal` / `turbo-drawer` to `turbo-overlay`, and `aria-labelledby` ids include `<%= current_overlay_id %>`.
5. If you have controllers that explicitly responded with `turbo_stream.overlay(:close)` after a successful action — no change needed; it now closes the top overlay (same observed behavior in non-stacked apps).

## 0.2.0

### Added
- **Drawer support.** Side-anchored overlay (`:left`, `:right`,
  `:top`, `:bottom`) that mirrors the modal pattern with its own
  frame, request variant, layout, and Stimulus controller.
- `config.drawer` configuration block. New default: drawer frame
  `turbo_drawer`, variant `:drawer`, layout `turbo_drawer`, position
  `:right`.
- Controller helpers: `drawer_request?`, `drawer_frame_id`,
  `drawer_layout_name`, plus a generic `overlay_request?` that
  returns true for any open overlay.
- View helpers: `drawer_link_to`, `drawer_dismiss_link_to`.
- `overlay_frame_tags` view helper that emits the receiving
  turbo-frames for all configured overlay types in one call. Drop it
  into the application layout once.
- Drawer themes ship for tailwind, bootstrap5, and plain. Bootstrap 3
  is intentionally not shipped (no native drawer/offcanvas
  primitive); the generator auto-skips drawer install for that theme.

### Changed
- **Install generator unified.** `bin/rails g turbo_overlay:install`
  now installs both modal and drawer by default. Pass `--skip-modal`
  or `--skip-drawer` to install only one. `install_drawer` removed —
  one entry point handles every combination.
- Initializer template now includes both `config.modal` and
  `config.drawer` blocks.
- Generator injects `<%= overlay_frame_tags %>` instead of an
  explicit `turbo_frame_tag`. Both forms are still detected so
  re-runs are idempotent.

## 0.1.0

### Added
- Initial release.
- Controller concern that detects overlay-frame requests, sets a
  `request.variant`, and exposes `modal_request?` / `modal_layout_name`.
- View helpers `modal_link_to`, `modal_dismiss_link_to`, and generic
  `overlay_title` / `overlay_footer` content helpers.
- Stream helper for `turbo_stream.overlay(:close)`. Polymorphic —
  closes any open overlay regardless of type.
- Install generator with four shipped themes for modals: `tailwind`,
  `bootstrap5`, `bootstrap3`, `plain`. Auto-injects the modal frame
  and Stimulus controller wiring.
