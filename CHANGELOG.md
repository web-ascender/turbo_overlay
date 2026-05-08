# Changelog

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
