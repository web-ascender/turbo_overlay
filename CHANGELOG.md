# Changelog

## [Unreleased]

### Added
- Initial release.
- Controller concern that detects overlay-frame requests, sets a
  `request.variant`, and switches to the overlay layout.
- View helpers `overlay_link_to` and `overlay_dismiss_link_to`.
- Stream helper for `turbo_stream.overlay(:close)`.
- Response header (`Turbo-Refresh-Frame`) for refreshing parent frames
  after a successful overlay submission.
- Install generator with four shipped themes: `tailwind`, `bootstrap5`,
  `bootstrap3`, `plain`.
- Stimulus controllers for each theme (native `<dialog>`, Bootstrap 5
  modal, Bootstrap 3 jQuery modal).
