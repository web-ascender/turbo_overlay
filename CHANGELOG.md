# Changelog

## Unreleased

### Fixed
- **Popover-style confirm now works for `link_to … data-turbo-method` triggers.** Turbo's link-method path synthesizes a hidden form and submits it without a submitter argument, so the `Turbo.config.forms.confirm` hook received `submitter = null` and the gem silently demoted popover-style to modal. The confirm registration now captures the originating `[data-turbo-confirm]` element on click (capture phase, freshness-bounded) and uses it as the popover anchor when Turbo loses the submitter. Real form-button submissions are unaffected — Turbo's submitter still wins when present.

### Added
- **Auto-render `+hint` variant template as the hint body.** When no explicit `turbo_overlay_hint do … end` capture is present, `overlay_stack_tag` looks for the current action's `+hint` variant (e.g. `show.html+hint.erb`) and renders it as the hint body. Drop the hint content in one file (`show.html+hint.erb`) and it serves both the prefetch path (via this auto-render) and the explicit `hint_url:` path (via Rails' standard variant resolution). Explicit `turbo_overlay_hint` capture still wins when present. Gated on `turbo_overlay_hintable_request?` so regular page renders don't pay the template-render cost. Detection is strict: `lookup_context.find_all(..., variants: [:hint])` plus an identifier-level `+hint.` check, so Rails' variant fallback to the no-variant template doesn't accidentally render the entire page as the hint.
- **`turbo_overlay_hint` no-ops on non-hintable requests.** The capture block is skipped on regular page navigations, form submissions, and anything that isn't a Turbo prefetch or `:hint` variant fetch. Detection uses `X-Sec-Purpose: prefetch` (Turbo's prefetch header — the W3C `Sec-*` prefix is forbidden for JavaScript-set fetch headers, so Turbo prepends `X-`) plus `X-Turbo-Overlay: hint` for the explicit variant fetch path. Adds `turbo_overlay_prefetch_request?` and `turbo_overlay_hintable_request?` controller predicates.
- **Loading state for overlay clicks.** A `modal_link_to` / `drawer_link_to` / `popover_link_to` click now drops a placeholder dialog into the stack as soon as the request flies, so the user sees immediate feedback even on slow controllers. The placeholder inherits the link's options (`backdrop:`, drawer `position:`, popover `position:` / `align:` / `offset:`, `close_button:`) so the loader reads visually the same as the eventual chrome. When the server-rendered overlay arrives in its turbo-stream, Turbo's `before-stream-render` event removes the placeholder; the same cleanup fires on fetch errors and on `turbo:visit`. Cloned at click time from `<template id="turbo_overlay_loading_<modal|drawer|popover|hint>_template">` emitted by `overlay_stack_tag`, so loading visuals are fully ERB-customizable.
- **Pending hints with `_loading.html+hint.erb`.** While a hover prefetch is in flight, the gem now paints a pending hint placeholder after `show_delay_ms` instead of staying invisible. When the response lands, the placeholder swaps in-place to the real hint with no flicker; if the response carries no hint template, it dismisses silently. Fixes the prior race where slow responses past `show_delay_ms` would never show a hint until a second hover hit the cache.
- **`_loading.html+<variant>.erb` chrome partials** for `modal`, `drawer`, `popover`, and `hint`, shipped per theme. Like `_confirm.html+modal.erb`, these are body-only partials that the gem wraps in the matching chrome at template-emission time, so the host app doesn't repeat `<%= render "turbo_overlay/modal" do %>` boilerplate.
- **Hint fallback when Turbo prefetch is disabled.** Sites that set `<meta name="turbo-prefetch" content="false">` or `data-turbo-prefetch="false"` on a link (or ancestor) previously had no working hints — Turbo never fired a prefetch and the gem had nothing to listen for. The hint controller now detects these opt-outs and fetches the URL itself with the same shape Turbo would have used, so `hint_link_to` works on prefetch-disabled sites without requiring `hint_url:`.
- **Negative cache for "no-hint" responses.** When a prefetch (or manual hint fetch) returns a response without a `<template id="turbo-overlay-hint">` — or when the fetch errors out — the URL is cached as `NO_HINT`. Subsequent hovers short-circuit at the show-delay tick: no pending placeholder is painted, no fetch is repeated. The negative cache clears on `turbo:visit` so navigation gives the gem a fresh shot at discovering a hint.
- **Hover hints with Turbo prefetch coordination.** A new `hint_link_to "User", user_path(@user)` (or `hint: true` / `hint_url:` on any existing overlay link helper / plain `link_to`) shows a small preview popover after the user hovers ~250ms. Hint content comes from a `<template id="turbo-overlay-hint">` the gem embeds via `turbo_overlay_hint do … end` on the page; Turbo prefetches the page on hover, the gem listens for `turbo:before-fetch-response`, extracts the template, and shows it. **Single fetch, two purposes** — the prefetch warms the navigation AND seeds the hint. For overlay links Turbo refuses to prefetch (`data-turbo-stream`, `data-turbo-confirm`, non-GET), pass `hint_url:` and the gem fetches a leaner alternate URL with `:hint` request variant on hover. Redirects are handled (cache keyed under both request + response URL). Inert on touch devices (`(hover: none)`). Configurable via `config.hint` — `enabled`, `show_delay_ms`, `hide_delay_ms`, `template_id`. Theme chrome partials shipped for every theme; install + eject generators wire them up.
- **Popover overlay type.** New `popover_link_to "Edit", path` opens its target as a non-modal `<dialog>` anchored to the clicked link, with auto-flip when near a viewport edge. `position:` (`:top` / `:bottom` / `:left` / `:right`), `align:` (`:start` / `:center` / `:end`), and `offset:` (pixels) tune the placement; defaults are configurable via `config.popover`. ESC and click-outside dismiss. Opening a second popover automatically dismisses the previous one — modals and drawers still stack on top. Includes a `popover_request?` controller/view predicate, `popover_dismiss_link_to`, `popover_layout_name`, the `:popover` request variant, `turbo_stream.overlay(:close, type: :popover)`, and chrome partials for every shipped theme.
- **Popover-style `data-turbo-confirm`.** Set `config.confirm.style = :popover` (or `data-turbo-confirm-style="popover"` on a per-link basis) and confirm prompts render anchored to the clicked submitter instead of a centered modal. Particularly nice for destructive actions next to a row's delete button. Default remains `:modal` — no behavior change unless opted in. The gem now ships paired `_confirm.html+modal.erb` and `_confirm.html+popover.erb` partials per theme; `overlay_stack_tag` emits one `<template>` per variant that's present in the host app, so apps that only install one style get only that style. If neither template is present, the hook falls back to the browser-native `confirm()`.
- **Default close button in modal/drawer chrome.** The chrome partials now render a close ("×") button regardless of whether `overlay_title` is set — floating in the top-right when there's no header, otherwise inside it. Suppress per overlay with `<% overlay_close false %>` in the view, `close_button: false` on the link helper, or a `close_button: false` local when rendering the partial directly (used internally by `_confirm.html.erb`). Adds `turbo_overlay_close?` helper and the `X-Turbo-Overlay-Close` header pipeline (mirrors `backdrop:`).
- **`backdrop: false` on `drawer_link_to`.** Opens the drawer non-modally (`dialog.show()` instead of `showModal()`). No backdrop, page stays scrollable and selectable, click outside is ignored. ESC still closes (synthesized via a keydown listener, since native `<dialog>` doesn't fire `cancel` in non-modal mode). Useful for inspector-style drawers where the user needs to read or copy from the host page.
- **`position:` on `drawer_link_to`.** Per-link override (`:left`, `:right`, `:top`, `:bottom`) for the configured `drawer.position` default.
- **Themed confirm dialogs.** Pass `{ confirm: true }` to `register(application, …)` and `data-turbo-confirm` on links/forms goes through the gem's themed modal instead of the browser-native `confirm()`. Body is cloned from a `<template>` rendered once into the page by `overlay_stack_tag`; falls back to `window.confirm` if the template is absent.
- **App-owned chrome partials.** Install drops `_modal.html.erb`, `_drawer.html.erb`, and `_confirm.html.erb` into `app/views/turbo_overlay/`. They're yours to edit — change classes, restyle, swap markup. Theme content scanners (Tailwind etc.) pick them up here automatically.
- **Bootstrap 3 drawer support.** Previously skipped (no native offcanvas primitive); now provided as a vanilla dialog styled with BS3 panel classes.
- **Dark-mode classes on the Tailwind theme.**
- `turbo_overlay_position` and `turbo_overlay_backdrop?` controller / view helpers, exposing the per-link overrides to overlay layouts.

### Changed
- **Renamed `current_overlay_*` helpers to `turbo_overlay_*`.** Vendor-prefixes the per-request accessors so they don't collide with host-app `current_*` conventions (which carry Rails session-scope semantics — `current_user`, `current_account`). Affects: `current_overlay_id`, `current_overlay_type`, `current_overlay_position`, `current_overlay_align`, `current_overlay_offset`, `current_overlay_backdrop?`, `current_overlay_close?`, and `current_overlay_frame_id`. Hard rename, no aliases. Action helpers (`modal_link_to`, etc.), content helpers (`overlay_title`, `overlay_footer`), and the stack tag (`overlay_stack_tag`) keep their existing names — they follow Rails action/content conventions and "overlay" is gem-owned domain terminology.
- **Chrome wrapping moved into `overlay_stack_tag`.** Variant partials for confirm and loading (`_confirm.html+modal.erb`, `_loading.html+modal.erb`, etc.) are now body-only — no `<%= render "turbo_overlay/modal" do %>` boilerplate. `overlay_stack_tag` calls `render(partial: "turbo_overlay/confirm", layout: "turbo_overlay/<variant>", variants: [...], locals: ...)` so the chrome partial wraps the body at template-emission time. Chrome partials gained a `loading:` local that suppresses the Stimulus controller, close button, and overlay title/footer slots, and swaps `aria-labelledby` for `role="status" aria-live="polite" aria-label="Loading"`. Class lists across all chrome partials migrated to Rails' `token_list` helper for readability.
- **`_confirm.html.erb` shared fallback** alongside the existing `_confirm.html+modal.erb` / `_confirm.html+popover.erb` variants. Same for `_loading.html.erb`. Apps that want a single confirm/loading body across chromes ship one file; per-chrome overrides still win when present.
- **Eager client-side overlay ids.** The stack controller now mints an `ov-<rand>` overlay id at click time for all overlay link types (previously popover-only) so the loading placeholder can be tagged with the same id the server will use to render the real frame.
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
- **Bootstrap5 modal renders with the themed background.** The shipped `_modal.html+modal.erb` (and its install copy) wrapped `.modal-dialog` in `<dialog>` directly, but Bootstrap scopes `--bs-modal-bg` (and the other `--bs-modal-*` variables `.modal-content` reads) to the `.modal` selector. With no `.modal` ancestor, the modal painted with a transparent background. Wrapped `.modal-dialog` in `<div class="modal d-block position-static">` so the variables cascade; `d-block` overrides Bootstrap's `display: none` and `position-static` neutralizes its `position: fixed` so the native `<dialog>`'s top-layer placement still drives positioning. Also added `modal-dialog-centered` since the dialog now fills the viewport.
- **Slow overlay loads no longer double-animate.** The loading placeholder is now wrapped in a `<turbo-frame>` matching the eventual server frame id. When the response arrives, `before-stream-render` morphs the new dialog's attributes and children onto the placeholder dialog in place — same DOM node, `[open]` never drops, the open animation only ever plays once (when the placeholder first appeared). Previously the placeholder closed and the live dialog opened as separate nodes, leaving a one-frame gap plus a redundant slide/fade-in.
- **Dismissing a loading overlay cancels the request.** ESC or backdrop-click on a placeholder now calls `aborter.abort()` on an `AbortController` injected into Turbo's `fetchOptions.signal`, so the in-flight fetch is actually cancelled instead of letting the response complete and pop the overlay back open. `dismissedLoadingIds` is kept as a safety net for the (theoretical) race where the response is already mid-stream-render when abort fires, and is cleared at the start of every fresh request for the same id (overlay ids are sticky on the link element, so re-clicking a dismissed link must not get its response dropped).
- **Auto-hint variant detection no longer falls back to the base template.** `lookup_context.exists?(path, ..., variants: [:hint])` returns `true` whenever any template matches the base path — variant is treated as a preference, not a requirement. The auto-render path was therefore firing for every action with a regular view, rendering the entire `show.html.erb` as the hint body. Switched to `lookup_context.find_all(..., variants: [:hint])` + an identifier-level `+hint.` check so the auto-render only fires when an actual `+hint` sibling file exists on disk.
- **Prefetch detection uses `X-Sec-Purpose`, not `Sec-Purpose`.** Turbo can't set `Sec-Purpose` because `Sec-*` is on the Fetch spec's Forbidden Header list for JS-initiated requests, so Turbo prepends `X-`. The gem's prefetch detection was checking the W3C-standard name Turbo doesn't (and can't) send, so every hover prefetch was treated as a regular request: `turbo_overlay_hint` no-op'd, the template never made it into the prefetch response, and the JS dismissed the pending placeholder after caching `NO_HINT`.
- **Safety-net cap on pending hint placeholder.** If neither `hint-ready` nor `fetch-request-error` arrives within 10s (Turbo silently cancelling a queued prefetch, an indefinitely-hung server), the placeholder auto-dismisses and the URL is cached as `NO_HINT` so the next hover doesn't strand a new spinner.
- **Pending hint no longer disappears mid-flight.** A vestigial 750ms timeout was tearing down the pending placeholder before slow controllers could respond. Removed — the placeholder now stays until the response arrives, the user hovers away, or the page navigates.
- **Pending hint dismisses on no-template / errored responses.** Previously a race could strand the spinner forever when the prefetch landed before `show_delay_ms` and the response had no `<template id>`. Negative caching closes the race: the no-hint outcome is cached before the show timer fires.
- **`turbo:fetch-request-error` cleanup.** Network failures on hint prefetches now dismiss the pending placeholder and cache `NO_HINT` so subsequent hovers don't strand a new spinner.
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
