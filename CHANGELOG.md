# Changelog

## Unreleased

Big iteration cycle ahead of the first public release. Highlights:

### Changed
- **Smooth close on form-submit redirects.** Two improvements to the
  close-on-redirect path, both default-on; the existing
  `keep_overlay_open_on_redirect` / per-form opt-out covers both.
  Also fixes a pre-existing flash where Turbo would render the
  redirect target's HTML into the still-open overlay before the
  submit-end handler closed it — same-origin fetch follows preserve
  the `Turbo-Frame` / `X-Turbo-Overlay` headers, so the redirect
  target was being wrapped in overlay layout by the controller
  concern and morphed into the dialog. The per-dialog listener now
  stops the `turbo:before-fetch-response` event before Turbo's
  StreamObserver and FormSubmission can process it.
  - **Same-page redirects morph the host page behind the overlay
    before closing.** When the redirect target's pathname matches the
    URL the overlay was opened from, the gem fetches the target,
    morphs `document.body` (excluding the `overlay_stack_tag`
    container so the open dialog is preserved), updates the URL via
    `history.replaceState`, then animates the close. No more
    flash-of-stale-content while the overlay closes. Modal/drawer
    only; falls back to the existing close-then-visit path when
    another overlay is open in the stack, when the fetch fails, or
    when `Turbo.morphChildren` is unavailable. Uses
    `window.Turbo.morphChildren` (public API in Turbo 8) so morph
    runs through Turbo's own Idiomorph copy and `data-turbo-permanent`
    + `turbo:before-morph-*` events compose normally — no new
    dependency. The opener URL is captured on the dialog as
    `data-turbo-overlay-opener-url` on Stimulus connect; the morph-
    attribute preservation hook keeps it intact through in-overlay
    form re-renders.
  - **Different-page redirects await the close animation before
    navigating.** Previously `Turbo.visit` fired immediately after
    starting the close, so the new page could paint behind a
    still-closing overlay. The submit-end handler now `await`s the
    overlay close (which returns a `Promise`) before invoking
    `Turbo.visit`. The close `Promise` resolves on `animationend`,
    the 400ms fallback timer, the reduced-motion shortcut, or the
    no-dialog shortcut — same lifecycle as before, just observable.
- **Form submissions inside an overlay close it on redirect by default.**
  When a descendant form submits and the response is a followed
  redirect (`fetchResponse.redirected === true`), the overlay closes
  and the browser visits the redirect target via `Turbo.visit`. Apps
  previously relying on explicit `turbo_stream.overlay(:close)`
  responses keep working unchanged — the stream-action path runs
  before any redirect would. Validation failures
  (`:unprocessable_entity`, 422) don't redirect, so in-place form
  re-renders are untouched. Two opt-outs, finest-grained wins:
  - **Per-overlay (link helper):**
    `modal_link_to "Wizard", path, keep_overlay_open_on_redirect: true`
    (also on `drawer_link_to` and `popover_link_to`). Round-trips
    through the `X-Turbo-Overlay-Keep-Open` request header to a
    `data-turbo-overlay-keep-open-on-redirect="true"` attribute on
    the `<dialog>`.
  - **Per-form (data attribute):**
    `<form data-turbo-overlay-keep-open-on-redirect="true">` opts
    out a single form while sibling forms in the same overlay still
    close on redirect.
  Detection is a per-dialog `turbo:submit-end` listener installed
  in the gem's Stimulus controller — scoped to descendants of the
  dialog, auto-cleaned on disconnect, never document-scoped. The
  decision lives in `app/javascript/turbo_overlay/submit_close.js`
  (`shouldCloseOnRedirect`) as a pure function. Hosts whose form
  redirects previously fell into a broken frame-replacement state
  (the redirect target had no matching `turbo_overlay_<type>_<id>`
  frame) get correct behavior now.
- **In-overlay form re-renders now morph the dialog in place.**
  `overlay_response_wrapper` emits a `<turbo-stream action="replace"
  method="morph">` on a frame re-render (form validation failure
  inside an open overlay) instead of a bare `<turbo-frame>`. Idiomorph
  preserves the `<dialog>` node identity, top-layer membership,
  popover anchor coordinates, stack registration, and the
  document-level ESC / outside-click / reflow handlers the per-dialog
  Stimulus controller installed on first open. Previously Turbo
  replaced the frame's contents wholesale; for popovers this detached
  the new dialog from its anchor and re-rendered it centered, and for
  every overlay type it leaked the original controller's document
  handlers. The after_action that sets `text/vnd.turbo-stream.html`
  on initial-open responses now also runs on frame re-renders so
  Turbo processes the embedded `<turbo-stream>`. `request.format`
  stays `:turbo_stream` on re-renders — apps' `respond_to`
  `format.turbo_stream` branches keep running on successful saves;
  implicit `render :edit` calls still find `edit.html.erb` via
  Rails' format-fallback. A `turbo:before-morph-attribute` hook in
  `setup.js` preserves the two attributes the JS owns on overlay
  dialogs (`open` and inline `style`) so idiomorph doesn't strip them.
- **Auto-installed overlay `layout` proc.** Including
  `TurboOverlay::Controller` now declares `layout -> { turbo_overlay_layout }`
  on its own, so host apps no longer hand-write a `resolve_layout`
  method. The proc also re-installs Turbo's `"turbo_rails/frame"`
  layout for plain turbo-frame requests, so including the concern
  does not regress Turbo's frame-layout optimization. Apps with a
  custom layout method call `turbo_overlay_layout` from it (see
  README "A note on custom layouts").
- **Bundled layouts moved to `app/views/layouts/turbo_overlay/{modal,drawer,popover,hint}.html.erb`**
  to mirror `turbo_rails/frame.html.erb`. Layout names returned by
  the helper are now `"turbo_overlay/modal"`, `"turbo_overlay/drawer"`,
  `"turbo_overlay/popover"`, `"turbo_overlay/hint"`.

### Fixed
- **Hover prefetch of in-overlay links no longer replaces the open
  overlay.** Turbo's hover prefetch sends the enclosing frame's id
  in the `Turbo-Frame` header. The controller concern was falling
  into its in-overlay form-re-render branch on that header, routing
  the prefetched URL through the overlay layout and returning a
  turbo-stream that morphed the open overlay's contents on receipt.
  The concern now skips the Turbo-Frame fallback when
  `X-Sec-Purpose: prefetch` is set — explicit overlay opens
  (`X-Turbo-Overlay` header) are unaffected. The same guard runs in
  `turbo_overlay_frame_re_render?` so the response Content-Type
  stays consistent with the body. As a complementary bandwidth save,
  dismiss links (`modal_dismiss_link_to` etc.) rendered inside an
  overlay now set `data-turbo-prefetch="false"` since their click
  is preventDefault'd by the Stimulus action.
- **Closing the last advance overlay no longer leaves Turbo's
  progress bar stuck at the top of the page.** When the entry
  beneath the advance overlay has Turbo's restoration state (e.g.
  the page that was loaded via Turbo Drive before opening any
  overlay), the gem cancels the proposed restore visit — but
  `FetchRequest#perform` had already started on a microtask and
  would call `visit.requestStarted()` after our handler returned,
  scheduling a `.turbo-progress-bar` timer that never gets cleared
  (canceled visits don't fire `visitCompleted`). The gem now stubs
  `visit.requestStarted` to a no-op before canceling and clears
  the stray `aria-busy` attribute that
  `Session#visitStarted` left on `<html>`.
- **Closing the top of a stacked advance overlay no longer tears
  down the whole stack.** Two compounded bugs:
  (a) The gem's `turbo:before-cache` handler ran
  `tearDownAllOverlays` for every cache snapshot — including the
  one Turbo Drive's `historyPoppedWithEmptyState` triggers
  synchronously on every popstate without a visit. Now gated on a
  `_realVisitInProgress` flag set in `turbo:before-visit` so only
  real visits clear overlays.
  (b) For popstates where the popped entry carries Turbo's own
  restoration state (e.g. backing out of an advance overlay to a
  Turbo-loaded page), Turbo proposes a restore visit that would
  load the cached snapshot and replace the page. The gem now
  cancels that restore visit from `turbo:visit` (action="restore")
  when an advance overlay is involved — leaving the overlay close
  to the popstate handler. Visit cancellation aborts the queued
  render before `cacheSnapshot()` runs, so no `before-cache` side
  effects either.

### Removed
- `modal/drawer/popover/hint.layout_name` configuration and the
  matching `modal_layout_name` / `drawer_layout_name` /
  `popover_layout_name` / `hint_layout_name` controller helpers.
  Layout names are now hard-coded. Host apps that want a different
  layout file can place their own at
  `app/views/layouts/turbo_overlay/modal.html.erb` (Rails view
  precedence wins over the gem's copy).

### Added
- **Popovers auto-close when their anchor scrolls out of view.** A
  popover whose trigger isn't visible reads as a floating widget with
  no obvious connection to anything; matching Bootstrap / MUI /
  native iOS UIPopover, the popover now collapses when its anchor
  exits the viewport. Short ~50ms debounce so momentum scrolls that
  briefly clip the edge don't dismiss. The popover continues to track
  the anchor through the dismissal so it slides offscreen alongside
  the trigger rather than getting glued to the viewport.
- **Popover positioning moved to compositor-thread transforms.**
  Replaced the per-scroll `style.top`/`style.left` writes with a
  single `transform: translate(...)`. Eliminates the one-frame lag
  ("springy" feel) on smooth/momentum scrolling. Popover open/close
  keyframes compose with the positioning transform via
  `animation-composition: add`.
- **`TurboOverlay.visit(url, options)` — open overlays from JavaScript.**
  Programmatic counterpart to `modal_link_to` / `drawer_link_to` /
  `popover_link_to` for non-anchor triggers (Google Maps markers, SVG
  hit regions, custom elements). Full option parity with the link
  helpers; popovers require an `anchor` element for positioning.
  Exposed as a named export from the package and as `window.TurboOverlay`
  for non-bundler callers. Reuses the existing fetch pipeline — same
  headers, same loading placeholder, same lifecycle events.
- **URL advance for modals and drawers.** Pass `advance: true` on
  `modal_link_to` / `drawer_link_to` (or set
  `c.modal.advance = true` / `c.drawer.advance = true` in the
  initializer) to push a history entry when the overlay opens.
  Browser-back closes the top overlay instead of navigating away
  from the page beneath. Per-link override accepts `true` (push the
  link's href), a String (push a custom URL), or `false` (opt out
  when the type default is on). Popovers and hints never advance —
  they're ephemeral and shouldn't churn browser history.
- **Popover overlay type.** `popover_link_to "Edit", path` opens its
  target as a non-modal `<dialog>` anchored to the clicked link.
  Per-link `position:`, `align:`, `offset:`; auto-flips on viewport
  overflow; ESC and click-outside dismiss. Opening a second popover
  dismisses the previous one — modals and drawers still stack on top.
- **Hover hints.** `hint_link_to "User", user_path(@user)` (or
  `hint: true` / `hint_url:` on any overlay link helper) shows a
  preview popover after ~250ms hover. Content comes from a `+hint`
  variant template (`show.html+hint.erb`) that `overlay_stack_tag`
  auto-emits on hintable requests. Piggy-backs on Turbo's hover
  prefetch — one fetch warms navigation and seeds the hint. Falls
  back to its own `fetch()` on prefetch-disabled sites; negative-caches
  no-hint responses; ships a pending placeholder for slow controllers.
- **Loading state for overlay clicks.** Every modal/drawer/popover/hint
  click drops a placeholder dialog matching the eventual chrome,
  morphed in-place when the real response lands. ESC/backdrop-click
  on a placeholder cancels the in-flight fetch via `AbortController`.
- **Themed `data-turbo-confirm`.** `register(application, { confirm: true })`
  routes confirm prompts through the gem's themed dialog. Pick modal
  or popover style globally (`config.confirm.style`) or per-link
  (`data-turbo-confirm-style`). Falls back to `window.confirm` when
  the template is absent.
- **Overlay lifecycle JS events:** `turbo-overlay:shown`,
  `turbo-overlay:before-close`, `turbo-overlay:closed`,
  `turbo-overlay:hint-shown`, `turbo-overlay:hint-ready`. All bubble
  from the dialog (or document, for hint events) so apps can wire
  autofocus, analytics, and cleanup without monkey-patching.
- **Drawer per-link options.** `position:` (`:left`/`:right`/`:top`/`:bottom`)
  overrides the configured default. `backdrop: false` opens the drawer
  non-modally so the host page stays interactive.
- **Default close button** in modal/drawer chrome — floating top-right
  when no header, inside the header when `overlay_title` is set.
  Suppress with `<% overlay_close false %>`, `close: false` on the
  link, or a `close: false` partial local.
- **App-owned chrome partials.** Install drops `_modal.html.erb`,
  `_drawer.html.erb`, `_popover.html.erb`, `_hint.html.erb`, and
  body-only `_confirm.html.erb` + `_loading.html.erb` into
  `app/views/turbo_overlay/`. Tailwind content scanners pick them up
  automatically.
- **Bootstrap 3 drawer support** as a vanilla dialog styled with BS3
  panel classes.
- **Dark-mode classes on the Tailwind theme.**

### Changed
- **Single native `<dialog>` JS controller for every theme.** Bootstrap
  themes keep their visual classes but no longer require
  `window.bootstrap` or jQuery — the `<dialog>` element drives
  open/close, stacking, and focus management.
- **Animations on by default.** Modals fade/scale, drawers slide from
  their configured edge, backdrops fade. All honor
  `prefers-reduced-motion: reduce`.
- **CSS ships as a real stylesheet asset** (propshaft / sprockets /
  bundler-friendly) — the interim `turbo_overlay_styles` view helper
  is gone.
- **Stimulus controllers shipped from the gem with importmap auto-pin.**
  Bundler apps reference the gem's `app/javascript` directly or use
  `bin/rails g turbo_overlay:eject --js` to copy locally.
- **Backdrop click dismisses by default.** Opt out with
  `data-turbo-overlay-backdrop-dismiss-value="false"`.
- **Stacked overlay links target `_top`** so modal/drawer links inside
  an open overlay stack a new one instead of replacing the current
  frame.
- **Helpers renamed for namespacing.** `current_overlay_*` →
  `turbo_overlay_*`; `close_button:` → `close:` on link helpers;
  hint predicates moved to the `overlay_` namespace. Hard renames, no
  aliases.
- **Install footprint shrunk** to one `_loading.html.erb` and one
  `_confirm.html.erb` per theme; chrome-specific overrides via
  `_loading.html+<variant>.erb` / `_confirm.html+<variant>.erb` still
  win when present.
- **Chrome wrapping moved into `overlay_stack_tag`.** Confirm/loading
  partials are body-only; the chrome wraps them at template-emission
  time. Adds a `loading:` local to chrome partials that drops the
  Stimulus controller wiring, close button, and title/footer slots,
  and switches ARIA to `role="status"`.

### Removed
- `window.bootstrap` and jQuery requirements for the Bootstrap themes.
- Per-theme overlay controllers (one shared `overlay_controller.js`).
- Inline `<style>` blocks from every shipped overlay layout.
- Inline `turbo_overlay_hint do … end` capture helper — the `+hint`
  variant template is the canonical and only path now.
- Config knobs without real consumers: `OverlayTypeConfig#frame_id`,
  `#stimulus_identifier`, `HintConfig#enabled`, `#template_id`.

### Fixed
- **Form re-render keeps the overlay open** when a submission inside
  an open overlay responds `:unprocessable_entity` — the new dialog
  is re-opened in the same mode after Turbo's frame replacement.
- **Back/forward navigation no longer restores broken-state overlays.**
  `turbo:before-cache` tears down every overlay frame and aborts
  in-flight fetches so the cached snapshot has no overlay state to
  restore.
- **Bootstrap5 modal renders with the themed background** — `.modal-dialog`
  is now wrapped in `.modal.d-block.position-static` so Bootstrap's
  `--bs-modal-*` variables cascade.
- **Hint detection fixes:** `+hint` variant auto-render only fires
  when a real `+hint` sibling file exists on disk; prefetch detection
  uses `X-Sec-Purpose` (the prefix Turbo can actually set); pending
  placeholder dismisses on no-template / errored responses with
  negative caching to prevent stuck spinners.
- **Popover-style confirm works for `link_to … data-turbo-method`** —
  the originating element is captured on click so the popover has an
  anchor when Turbo's submitter is null.
- Stacked overlay close animation is now reliable across themes.
- **Popover inside an open modal is interactive again.** HTML's
  modal-dialog inertness algorithm blocks every non-descendant of the
  topmost modal from receiving input — even top-layer popovers added
  via `showPopover()` afterwards. Popovers opened from inside a modal
  now use `showModal()` themselves (with a transparent `::backdrop`)
  so they become the topmost modal and stay interactive.
- **Popover and hint positioning no longer drifts toward the viewport
  center.** UA `[popover]` styles include `inset: 0; margin: auto` —
  setting only `top`/`left` left the leftover space to be distributed
  via the auto margins, so the dialog rendered partway between the
  trigger and the viewport edge. Now sets `right: auto; bottom: auto;
  margin: 0` before measuring so the dialog stays anchored.
- **Popover anchored to wrapping inline link uses the clicked line.**
  `getBoundingClientRect()` on a multi-line `<a>` returns the union
  of every line box. The anchor math now picks the line containing
  the recorded click point.
- **Popover follows the trigger while a parent overlay animates.**
  Opening a popover while the drawer it's inside was mid-slide-in
  used to anchor against the still-moving rect. The positioner now
  re-runs each frame until the anchor stabilizes (~600ms cap).
- **Non-modal drawer trigger inside another overlay no longer
  dismisses the parent.** The link helper writes
  `data-turbo-overlay-backdrop="false"` on triggers to signal the
  fetch hook; the bootstrap5 modal chrome's wrapper marker shared
  that exact attribute name, so a bubbled click on the trigger was
  treated as a backdrop click. Chrome marker renamed to
  `data-turbo-overlay-backdrop-zone`.

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
