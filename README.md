# Turbo Overlay

Render any Rails view inside a stackable modal, drawer, or popover
using Turbo Streams — without duplicating templates, hand-rolling
Stimulus controllers, or coupling your domain to a CSS framework.

A single stack container on the host page receives appended overlays.
The gem detects overlay-bound requests, swaps in the matching layout,
exposes a Rails request variant for view-level customization, and
ships a turbo-stream action for dismissing whichever overlay is open
— or all of them.

**Overlays stack.** Open a modal/drawer/popover from inside an open
one and the new overlay slides on top instead of replacing it.
Dismissing affects only the topmost layer. Popovers are the one
exception: opening a second popover dismisses the previous one, since
"two free-floating popovers at once" is rarely what you want.

Themes for **Tailwind**, **Bootstrap 5**, **Bootstrap 3**, and
**plain CSS** ship in the gem and switch via a single config option.

## Requirements

- Rails ≥ 6.1
- turbo-rails ≥ 2.0 (Turbo 8) — required for `data-turbo-stream="true"` on GET links

## Installation

Add to your Gemfile:

```ruby
gem "turbo_overlay"
```

Then run the install generator:

```bash
bundle install
bin/rails generate turbo_overlay:install --theme tailwind
```

Themes: `plain` (default), `tailwind`, `bootstrap5`, `bootstrap3`.

The generator wires the host app and scaffolds the modal/drawer
chrome you'll customize:

- Copies the chosen theme's chrome partials to `app/views/turbo_overlay/`:
  `_modal.html.erb`, `_drawer.html.erb`, `_popover.html.erb`,
  `_hint.html.erb`, plus body-only `_confirm.html+<modal|popover>.erb`
  and `_loading.html+<modal|drawer|popover|hint>.erb` partials that the
  gem wraps in the matching chrome at template-emission time. These are
  *your* files — edit freely. Tailwind / similar content scanners pick
  them up here automatically (which they can't if the file lives inside
  the gem).
- Writes `config/initializers/turbo_overlay.rb`.
- Injects `<%= overlay_stack_tag %>` before `</body>` in
  `app/views/layouts/application.html.erb`.
- For **importmap-rails** apps: appends
  `import { register } from "turbo_overlay"; register(application, { confirm: true })`
  to your Stimulus entry (typically
  `app/javascript/controllers/index.js`). The `{ confirm: true }` flag
  routes `data-turbo-confirm` through the gem's themed modal — see
  "Themed confirm dialogs" below.
- For **propshaft** apps: injects a `stylesheet_link_tag "turbo_overlay"`
  into your application layout (next to the existing one). Propshaft
  doesn't rewrite CSS `@import` URLs to digested paths, so a separate
  link tag is the right primitive.
- For **sprockets** apps: injects `*= require turbo_overlay` into your
  manifest CSS.
- For **jsbundling / cssbundling** apps: prints the snippet you need to
  add (either to your bundler entry or via load-path config) — see
  "Bundling apps" below.

Re-running is idempotent — anything already in place is left alone.
Pass `--force` to overwrite existing chrome partials when switching
themes.

If you skip the install generator entirely, the gem ships a plain
`<dialog>` chrome as a fallback — modals and drawers work, just
unstyled beyond the gem's CSS.

### Bundling apps

jsbundling-rails (esbuild/rollup/webpack/bun) and cssbundling-rails
apps have two paths:

1. **Reference the gem in place** — add the gem's `app/javascript`
   and/or `app/assets/stylesheets` directories to your bundler's
   resolve paths. Then write the same imports as importmap apps:

    ```js
    import { register } from "turbo_overlay"
    register(application)
    ```

    ```css
    @import "turbo_overlay";
    ```

2. **Eject** — copy the gem's JS or CSS into your app and import
   locally. Run any combination of:

    ```bash
    bin/rails g turbo_overlay:eject --js
    bin/rails g turbo_overlay:eject --css
    bin/rails g turbo_overlay:eject --layouts
    ```

    (Chrome partials are not part of eject — they're already in your
    app after `turbo_overlay:install`.)

    Ejected files become yours; gem upgrades to those files no longer
    flow through.

The one remaining step is `ApplicationController`. Include the
controller concern and add a layout method that swaps to the matching
overlay layout per request:

```ruby
class ApplicationController < ActionController::Base
  include TurboOverlay::Controller
  layout :resolve_layout

  private

  def resolve_layout
    return modal_layout_name   if modal_request?
    return drawer_layout_name  if drawer_request?
    return popover_layout_name if popover_request?
    "application"
  end
end
```

The overlay layout **replaces** your application layout for overlay
requests — only the view content is wrapped in the dialog/drawer/popover
markup, not your nav, header, or footer. The host page already has
those; the appended overlay sits on top.

## Usage

### Open a view in a modal, drawer, or popover

```erb
<%= modal_link_to   "New User",   new_user_path %>
<%= drawer_link_to  "Filters",    filters_path %>
<%= popover_link_to "Edit",       edit_user_path(@user) %>
```

Modals and drawers stack — open one from inside another and the new
overlay sits on top. Popovers anchor to the clicked link and replace
each other on subsequent clicks; modals and drawers still stack on
top of an open popover.

### Per-link drawer overrides

`drawer_link_to` accepts two per-link kwargs that override the configured
defaults for that one link:

```erb
<%# Override the configured drawer side just for this link %>
<%= drawer_link_to "Filters", filters_path, position: :left %>

<%# Open without a backdrop — page stays scrollable and selectable,
    text on the host page can be copied into the drawer's form, etc.
    ESC still closes; click-outside is ignored (no backdrop to click). %>
<%= drawer_link_to "Inspector", inspect_path, backdrop: false %>
```

`position:` accepts `:left`, `:right`, `:top`, `:bottom` and overrides
`TurboOverlay.configuration.drawer.position` for the one link.

`backdrop: false` opens the drawer non-modally (`dialog.show()` instead
of `showModal()`). The browser doesn't render a `::backdrop`, the page
beneath stays fully interactive, and the page-wide scroll lock is
disabled. Useful when the user needs to read or copy from the host
page while the drawer is open. (See the table below for how this
differs from `backdrop-dismiss-value="false"`, which keeps the modal
backdrop visible but disables click-to-dismiss.)

### Anchored popovers

`popover_link_to` opens its target as a non-modal `<dialog>` anchored
to the link that was clicked — the same plumbing as modal/drawer, just
positioned relative to its trigger instead of centered or pinned to
an edge.

```erb
<%= popover_link_to "Edit", edit_user_path(@user) %>
```

Three per-link kwargs override the configured defaults:

```erb
<%= popover_link_to "Edit", edit_user_path(@user),
                    position: :top,    # :top, :bottom (default), :left, :right
                    align:    :center, # :start (default), :center, :end
                    offset:   8 %>     # pixels between trigger and dialog (default 4)
```

Popovers auto-flip across the cross axis when the preferred side would
overflow the viewport (e.g. `:bottom` becomes `:top` near the bottom
edge). Disable globally with `config.popover.auto_flip = false`.

Dismissal: ESC, clicking outside the popover, or any explicit
`turbo_stream.overlay(:close, type: :popover)`. Because popovers are
non-modal, the page beneath stays scrollable and interactive — the
popover repositions itself as the anchor scrolls.

**Single-popover behavior.** Opening a second popover automatically
dismisses any other open popover. Modals and drawers still stack as
normal — a modal opened from inside a popover sits on top, and
dismissing it leaves the popover anchored. (If you ever genuinely
need stacked popovers, open an issue; the behavior is intentionally
not configurable yet.)

**Links inside popovers target the top-level page by default.** A
plain `link_to` rendered inside a popover would otherwise navigate
inside the popover's turbo-frame and replace its contents. The
controller back-fills `data-turbo-frame="_top"` on any `<a>` that
doesn't already carry an explicit `data-turbo-frame` or
`data-turbo-overlay` — so a regular link navigates the page (closing
the popover), while `modal_link_to` / `drawer_link_to` /
`popover_link_to` keep their stacking behavior. Forms inside the
popover are untouched and still re-render in place on validation
failure.

**No default close button.** Unlike modals and drawers, popovers
don't render a "×" by default — they already dismiss on click-outside
/ ESC / opening another popover, and a button is mostly visual noise
in a small floating panel. Opt back in per-view with
`<% overlay_close true %>`, or globally by editing
`app/views/turbo_overlay/_popover.html.erb`.

### Loading state

Every `modal_link_to` / `drawer_link_to` / `popover_link_to` click drops
a loading placeholder into the stack immediately so the user sees
feedback even when the controller is slow. The placeholder inherits
the link's options — backdrop on/off, drawer position, popover
position/align/offset, close-button suppression — so it reads visually
the same as the eventual chrome. When the server-rendered overlay
arrives in its turbo-stream, Turbo's `before-stream-render` removes
the placeholder. The same cleanup fires on fetch errors and on
`turbo:visit`.

The placeholder is cloned from `<template id="turbo_overlay_loading_<modal|drawer|popover|hint>_template">`
that `overlay_stack_tag` emits — one per chrome type, rendered from
`_loading.html+<variant>.erb` (body-only) wrapped in the matching
chrome partial with `loading: true`. The `loading:` flag tells the
chrome partial to:

- skip the Stimulus controller wiring (the placeholder is static, not
  a real overlay)
- skip the close button, overlay title, and overlay footer slots
- swap `aria-labelledby` for `role="status" aria-live="polite"
  aria-label="Loading"`
- add a `turbo-overlay--loading` modifier class for any visual tweaks
  (the shipped CSS adds a spinner with `prefers-reduced-motion`
  support)

Apps that want a different spinner / different loading layout per
chrome type override `_loading.html+modal.erb` etc. — same body-only
contract as the confirm partials. Or to share one loader across all
four chromes, drop a single `_loading.html.erb` and delete the
variants.

### Hover hints

Hover over a link, get a small preview popover. The hint shows after
a short hover (default 250ms) and dismisses on mouseout (with a grace
window so the user can move into the hint to read or click). Combines
with Turbo's hover prefetch so the same fetch that warms the
navigation also seeds the hint — single fetch, two purposes.

The canonical way to provide hint content is a `+hint` variant
template next to the action's regular template:

```erb
<%# app/views/users/show.html+hint.erb %>
<h3><%= @user.name %></h3>
<p>Last seen <%= time_ago_in_words(@user.last_seen_at) %> ago</p>
```

```erb
<%# anywhere — make a link show that hint on hover %>
<%= hint_link_to "User", user_path(@user) %>
```

When another page links to `users/show` with `hint_link_to`, Turbo's
hover prefetch fetches the page; the gem hooks
`turbo:before-fetch-response`, finds a `<template id="turbo-overlay-hint">`
in the prefetched HTML, caches the fragment by URL, and shows it on
hover delay.

`overlay_stack_tag` emits that template automatically: on a hintable
request (Turbo prefetch or explicit `:hint` variant fetch) it looks
for the action's `+hint` variant and, if one exists, wraps it in the
hint chrome and inlines it as `<template id="turbo-overlay-hint">`.
On a regular page render the variant isn't loaded — no DB cost, no
partial render.

Detection uses `X-Sec-Purpose: prefetch` (Turbo's prefetch header —
the W3C `Sec-*` prefix is forbidden for JavaScript-set fetch headers,
so Turbo prepends `X-`) and `X-Turbo-Overlay: hint` for the explicit
fetch path.

#### Compose with overlay link helpers

`hint:` / `hint_url:` work on every overlay helper:

```erb
<%= modal_link_to   "Edit", edit_user_path(@user),
                    hint: true, hint_url: hint_user_path(@user) %>
<%= drawer_link_to  "Filters", filters_path,
                    hint: true, hint_url: hint_filters_path %>
<%= popover_link_to "Edit", edit_user_path(@user),
                    hint: true, hint_url: hint_user_path(@user) %>
```

Or via plain `link_to` if you don't want the helper sugar:

```erb
<%= link_to "User", user_path(@user),
            data: { turbo_overlay_hint: true,
                    turbo_overlay_hint_url: hint_user_path(@user) } %>
```

#### Plain links vs overlay links

**Plain links** (no `data-turbo-stream`) ride Turbo's hover prefetch.
Drop a `show.html+hint.erb` on the destination page and you're done.

**Overlay links** (`modal_link_to` / `drawer_link_to` /
`popover_link_to`) carry `data-turbo-stream="true"`, which **Turbo's
hover prefetch ignores**. For these, provide an explicit `hint_url:`
that the gem fetches with the `:hint` request variant on hover. Rails
resolves the same `+hint` variant template; the gem's `turbo_hint`
layout wraps it in `<template id="turbo-overlay-hint">` for the JS
extractor.

```erb
<%# app/views/clients/dashboard/show.html+hint.erb %>
<h3><%= @client.name %></h3>
<p>Last updated <%= time_ago_in_words(@client.updated_at) %> ago</p>
```

```erb
<%# anywhere — both work, both show the same hint body %>
<%= hint_link_to "Open", client_root_path(@client) %>
<%= modal_link_to "Agency view", agency_client_path(@client),
                  hint: true, hint_url: client_root_path(@client) %>
```

#### Pending placeholder while the hint loads

After `show_delay_ms`, if the hint content isn't cached yet, the gem
paints a pending placeholder (cloned from
`_loading.html+hint.erb`) so the user sees feedback while the
prefetch or `hint_url:` fetch is in flight. When the real content
lands the placeholder swaps in place — no flicker. If the response
carries no hint template (or the request errored out), the
placeholder dismisses silently.

This fixes a race that used to bite slow controllers: if the response
arrived after `show_delay_ms`, the user would never see a hint until
the next hover hit the cache.

#### Prefetch-disabled sites

If the site sets `<meta name="turbo-prefetch" content="false">`, or
the link / an ancestor has `data-turbo-prefetch="false"`, Turbo won't
prefetch for the gem to piggy-back on. The hint module detects these
opt-outs and falls back to a plain `fetch()` of the URL — same shape
Turbo's prefetch would have used, so an existing `+hint` variant
template keeps working without any extra config.

#### Negative caching

When a hint-marked URL is fetched and the response has no
`<template id="turbo-overlay-hint">` (or the fetch errors), the gem
caches a `NO_HINT` sentinel for that URL. Subsequent hovers
short-circuit at the show-delay tick: no placeholder is painted, no
fetch is repeated. The negative cache clears on `turbo:visit`, so a
page navigation gives the gem a fresh chance to discover a hint.

#### Touch, accessibility, and dismissal

- **Touch devices** (`(hover: none)`) are detected at `connect` and
  the controller short-circuits — no hint behavior, no listeners.
- **Keyboard accessibility**: focusing a hint-marked link shows the
  hint after the same delay; blurring it starts the grace timer.
  The hint element gets a `role="tooltip"` and is linked to the
  trigger via `aria-describedby` while visible.
- **Dismissal**: mouseout (with grace), focusout (with grace), ESC,
  Turbo navigation (`turbo:visit`), or any click intercepted by Turbo
  (`turbo:click`). Hints don't participate in the overlay stack —
  they dismiss purely client-side, which is the documented exception
  to "closing is always explicit" (see below).

#### Redirects

If `users/42` redirects to `profiles/42`, the gem caches the
extracted fragment under **both** URLs so hovering either link in
the same page lifetime resolves to the same hint without a refetch.

#### Tuning the delays

```ruby
TurboOverlay.configure do |config|
  config.hint.show_delay_ms = 400   # default 250
  config.hint.hide_delay_ms = 200   # default 120
end
```

Hints are inert on pages without `data-turbo-overlay-hint` markers,
so the module is free to leave enabled even for apps that don't use
hover previews.

### Stable ids and closing from server code

If you want to close a specific overlay later from server code, give
it an id at open time:

```erb
<%= modal_link_to "Edit user",
                  edit_user_path(@user),
                  overlay_id: "edit_user_#{@user.id}" %>
```

Then on the server:

```ruby
turbo_stream.overlay(:close, id: "edit_user_#{@user.id}")
```

When `overlay_id:` is omitted, the gem generates a random id. Inside
the controller and views you can read it as `turbo_overlay_id` —
useful for closing the overlay you're currently rendering after a
side-effect:

```ruby
render turbo_stream: turbo_stream.overlay(:close, id: turbo_overlay_id)
```

### Customize what the overlay renders

The layout yields a body and reads two optional `content_for` blocks
via generic helpers. The keys (`:overlay_title`, `:overlay_footer`)
are intentionally generic so the same view renders correctly in
either a modal or a drawer.

```erb
<%# app/views/users/new.html.erb %>
<% overlay_title "New User" %>

<%= form_with(model: @user) do |f| %>
  <%= f.text_field :name %>
  <%# ... %>
<% end %>

<% overlay_footer do %>
  <%= modal_dismiss_link_to "Cancel", users_path, class: "btn btn-secondary" %>
  <button type="submit" class="btn btn-primary">Save</button>
<% end %>
```

The chrome partials render a default close ("×") button. When the
view sets `overlay_title`, it sits inside the header; without a title
it floats in the top-right corner. Suppress it per overlay with
`overlay_close false` in the view, or `close_button: false` on the
link helper:

```erb
<%# inside the rendered view %>
<% overlay_close false %>

<%# at the call site %>
<%= modal_link_to "Promo", promo_path, close_button: false %>
```

### Different markup for modal / drawer / popover / full-page renders

Drop variant templates alongside the standard one:

```
app/views/users/show.html.erb         # full-page version
app/views/users/show.html+modal.erb   # rendered when opened in a modal
app/views/users/show.html+drawer.erb  # rendered when opened in a drawer
app/views/users/show.html+popover.erb # rendered when opened in a popover
```

When the request hits via an overlay, Rails picks the matching variant.

> **Footgun: don't put `overlay_title` / `overlay_footer` in a template
> that also serves full-page renders.** Both helpers write to
> `content_for` keys (`:overlay_title`, `:overlay_footer`) that only the
> overlay chrome partials yield. The application layout doesn't yield
> them, so on a full-page render — e.g. when a user opens the overlay
> link in a new tab — the title and *every button inside
> `overlay_footer`* silently disappear. The form still posts, but
> there's no visible submit control.
>
> Two safe patterns:
>
> 1. **Use variant templates** (recommended). Put overlay-only chrome
>    in `show.html+modal.erb` and keep `show.html.erb` as a standalone
>    page with its own header and buttons. The two never share code
>    paths.
> 2. **Branch on `overlay_request?`** inside a single template when
>    you want one file:
>
>    ```erb
>    <% if overlay_request? %>
>      <% overlay_title "Edit user" %>
>      <%= render "form", user: @user %>
>      <% overlay_footer do %>
>        <button type="submit" form="user-form" class="btn btn-primary">Save</button>
>      <% end %>
>    <% else %>
>      <h1>Edit user</h1>
>      <%= render "form", user: @user %>
>      <button type="submit" form="user-form" class="btn btn-primary">Save</button>
>    <% end %>
>    ```
>
> Either way, make sure every overlay-targeted action also renders
> sensibly as a standalone page — "open link in new tab" is a real
> user habit, and the URL is a real Rails route.

### Close the overlay on a successful submission

`turbo_stream.overlay(:close)` closes the *top* overlay. From a deep
stack, send `scope: :all` to dismiss everything in one go, or target
a specific overlay by id.

```ruby
class UsersController < ApplicationController
  def create
    @user = User.new(user_params)

    if @user.save
      respond_to do |format|
        format.turbo_stream do
          flash.now[:notice] = "Created #{@user.name}."
          render turbo_stream: [
            turbo_stream.update("flash", partial: "shared/flash"),
            turbo_stream.overlay(:close)         # close top
          ]
        end
        format.html { redirect_to @user }
      end
    else
      render :new, status: :unprocessable_entity # form re-renders in place
    end
  end
end
```

`turbo_stream.overlay` accepted forms:

```ruby
turbo_stream.overlay(:close)                              # close the top overlay
turbo_stream.overlay(:close, scope: :all)                 # close every open overlay
turbo_stream.overlay(:close, scope: :all, type: :modal)   # close all modals only
turbo_stream.overlay(:close, scope: :all, type: :popover) # close all popovers only
turbo_stream.overlay(:close, id: "edit_user_42")          # close one specific
```

> **Closing is always explicit (for modals, drawers, and popovers).**
> This gem does *not* auto-close click-opened overlays on
> `turbo:submit-end`. A submission only closes the overlay if the
> response includes `turbo_stream.overlay(:close, …)`. That avoids
> surprise dismissals when a form inside the overlay should leave it
> open (wizard step, search, inline edit).
>
> **Hints are the exception** — they open from hover state and dismiss
> purely client-side on mouseout (with a grace window). There's no
> `turbo_stream.overlay(:close, type: :hint)` path for that reason.

### User-initiated dismissal

Out of the box the user can dismiss the top overlay by pressing
**ESC** or **clicking the backdrop**. Both go through the same
animated close path as the close button. To opt a specific overlay
out of backdrop-click dismissal — e.g. a form with unsaved input —
set the value to `false` on the `<dialog>`:

```erb
<dialog ...
        data-controller="turbo-overlay"
        data-turbo-overlay-backdrop-dismiss-value="false">
```

Two related knobs, easy to confuse:

| Setting                                          | Backdrop visible? | Click outside dismisses? | Page interactive? |
|--------------------------------------------------|:-----------------:|:------------------------:|:-----------------:|
| (default)                                        | ✓                 | ✓                        | —                 |
| `data-turbo-overlay-backdrop-dismiss-value="false"` | ✓              | —                        | —                 |
| `drawer_link_to ..., backdrop: false`            | —                 | — (no backdrop to click) | ✓                 |

On validation failure, just `render :new, status: :unprocessable_entity`.
The form lives inside a per-overlay turbo-frame, so Rails re-renders
the form and Turbo replaces the frame's contents in place — the
overlay stays open and shows errors. No special handling required.

### Themed confirm dialogs

`data-turbo-confirm` on links and forms normally pops the
browser-native `confirm()`. Pass `{ confirm: true }` to `register` and
they go through the gem's themed overlay instead — same dialog, same
animations, same stacking. No server round-trip; the dialog body is
cloned from a `<template>` rendered into the page once by
`overlay_stack_tag`.

```js
import { register } from "turbo_overlay"
register(application, { confirm: true })
```

```erb
<%= button_to "Delete", user_path(@user),
              method: :delete,
              data: { turbo_confirm: "Really delete this user?" } %>
```

The install generator drops two themed confirm partials into your app:

- `app/views/turbo_overlay/_confirm.html+modal.erb` — centered modal
- `app/views/turbo_overlay/_confirm.html+popover.erb` — anchored to the clicked submitter

Edit them freely. JS only depends on three data attributes:

| Attribute                                  | Role                                |
|--------------------------------------------|-------------------------------------|
| `[data-turbo-overlay-confirm-message]`     | element whose text becomes the message |
| `[data-turbo-overlay-confirm-cancel]`      | clicking resolves the promise as cancel |
| `[data-turbo-overlay-confirm-accept]`      | clicking resolves the promise as accept |

Each variant renders *inside* its corresponding chrome partial
(`_modal.html.erb` or `_popover.html.erb`), so retheming the chrome
carries through to confirm automatically. Delete either variant to
disable that style; delete both and the hook falls back to the
browser-native `confirm()`.

#### Modal or popover?

The default is `:modal`. Switch globally via the initializer:

```ruby
TurboOverlay.configure do |config|
  config.confirm.style = :popover   # default :modal
end
```

Or per-link, via a `data-turbo-confirm-style` data attribute (this
overrides the global default for the one link):

```erb
<%= button_to "Delete", user_path(@user),
              method: :delete,
              data: { turbo_confirm: "Really delete?",
                      turbo_confirm_style: "popover" } %>
```

Popover-style confirm needs an anchor — the element the user clicked
to trigger the form submission (`<button>` for `button_to`, `<a>` for
`link_to` with `method:`). If a programmatic submission triggers a
confirm with no submitter, the gem falls back to the modal style
silently rather than rendering a popover at the top-left corner.

### JavaScript events

The gem dispatches custom events at key moments so apps can wire
autofocus, analytics, cleanup, etc. without monkey-patching the
controllers.

| Event | Target | Detail | When |
| --- | --- | --- | --- |
| `turbo-overlay:shown` | dialog (bubbles) | `{ id, type }` | Overlay's controller is wired and the dialog is open + interactive. Fires once per overlay open, after a placeholder morph or on direct open. |
| `turbo-overlay:before-close` | dialog (bubbles) | `{ id, type }` | Close just started; the dialog is still visible. Not cancellable. |
| `turbo-overlay:closed` | dialog (bubbles) | `{ id, type }` | Close animation done, `<dialog>` has closed, the wrapping frame is about to be removed. The dialog node is still in the DOM at dispatch time so a bubbled listener can read its attributes. |
| `turbo-overlay:hint-shown` | document | `{ url }` | A hover hint just appeared (real content, not the pending placeholder). |
| `turbo-overlay:hint-ready` | document | `{ url, fragment }` | The gem extracted hint content for a URL — either from a Turbo prefetch, the gem's own `hint_url:` fetch, or a prefetch-disabled fallback fetch. Fires whether or not the hint will actually be shown. |
| `turbo-overlay:close` | window | `{ scope, type, id }` | Server-issued `turbo_stream.overlay(:close, …)` close command, or a teardown when a same-id overlay is being replaced. This is a command the stack controller routes — listen to `:before-close` / `:closed` for per-overlay lifecycle. |

The three lifecycle events bubble from the dialog, so you can listen
at any level:

```js
// Autofocus the first input in any newly-opened overlay:
document.addEventListener("turbo-overlay:shown", (event) => {
  const input = event.target.querySelector("input:not([type=hidden]), textarea, select")
  if (input) input.focus()
})

// Track overlay opens by id:
document.addEventListener("turbo-overlay:shown", (event) => {
  analytics.track("overlay_opened", event.detail)
})
```

## Configuration

```ruby
# config/initializers/turbo_overlay.rb
TurboOverlay.configure do |config|
  config.stack_id = "turbo_overlay_stack"  # host-page stack container DOM id

  config.modal do |m|
    m.variant     = :modal         # Rails request variant
    m.layout_name = "turbo_modal"  # layout file name
  end

  config.drawer do |d|
    d.variant     = :drawer
    d.layout_name = "turbo_drawer"
    d.position    = :right         # :left, :right, :top, :bottom
  end

  config.popover do |p|
    p.variant     = :popover
    p.layout_name = "turbo_popover"
    p.position    = :bottom        # :top, :bottom, :left, :right
    p.align       = :start         # :start, :center, :end
    p.offset      = 4              # pixels between trigger and dialog
    p.auto_flip   = true           # flip to opposite side on overflow
  end

  config.confirm do |cf|
    cf.style = :modal              # :modal (default) or :popover
  end

  config.hint do |h|
    h.show_delay_ms = 250          # hover must persist this long
    h.hide_delay_ms = 120          # grace window after mouseleave
  end
end
```

### Customizing the chrome

The install generator copies these partials into your app:

**Chrome partials** (the dialog/wrapper for each overlay type):

- `app/views/turbo_overlay/_modal.html.erb`
- `app/views/turbo_overlay/_drawer.html.erb`
- `app/views/turbo_overlay/_popover.html.erb`
- `app/views/turbo_overlay/_hint.html.erb`

**Body-only variant partials** (rendered *inside* the matching chrome
at template-emission time by `overlay_stack_tag`):

- `app/views/turbo_overlay/_confirm.html+modal.erb`
- `app/views/turbo_overlay/_confirm.html+popover.erb`
- `app/views/turbo_overlay/_loading.html+modal.erb`
- `app/views/turbo_overlay/_loading.html+drawer.erb`
- `app/views/turbo_overlay/_loading.html+popover.erb`
- `app/views/turbo_overlay/_loading.html+hint.erb`

These are *your* files. Edit them freely — change classes, add a
brand container, restyle the close button.

**Chrome partials** are rendered as layouts (`render layout: ...`),
so they use `<%= yield %>` for the body and read
`content_for(:overlay_title)` / `content_for(:overlay_footer)` for
the slots. Keep the `<dialog>` element's `data-controller="turbo-overlay"`
and its data values so the Stimulus controllers can attach. They
accept a `loading:` local — when `true`, the chrome drops the
Stimulus controller wiring, close button, and overlay title/footer
slots, and switches the ARIA role to `status` for the loading
placeholder use case.

**Body-only confirm/loading partials** only contain the content that
goes inside the chrome — no `<dialog>` wrapper, no Stimulus
controller. `overlay_stack_tag` does `render(partial: "turbo_overlay/confirm",
layout: "turbo_overlay/<variant>", ...)` so retheming the chrome
carries through to confirm and loading automatically.

Apps that want one confirm or loading body across chromes can ship a
single `_confirm.html.erb` or `_loading.html.erb` instead of the
variant files; per-chrome overrides still win when present.

If you delete these files, the gem's plain fallback partials kick in.
To switch themes (e.g. plain → tailwind), re-run install with
`--force`:

```bash
bin/rails g turbo_overlay:install --theme tailwind --force
```

## Helpers

Available on controllers (when the concern is included) and views:

| Helper                                  | Returns                                                                |
|-----------------------------------------|------------------------------------------------------------------------|
| `modal_request?` / `drawer_request?` / `popover_request?` / `hint_request?` | `true` if the current request targets that overlay type |
| `overlay_request?`                      | `true` if the current request targets *any* overlay                    |
| `turbo_overlay_type`                  | `:modal`, `:drawer`, `:popover`, `:hint`, or `nil`                     |
| `turbo_overlay_id`                    | The overlay id for the current request (user-supplied or generated)    |
| `turbo_overlay_position`              | Per-link position override (drawer or popover), or `nil`               |
| `turbo_overlay_align`                 | Per-link popover cross-axis alignment, or `nil`                        |
| `turbo_overlay_offset`                | Per-link popover pixel offset, or `nil`                                |
| `turbo_overlay_backdrop?`             | `false` only when the link opened with `backdrop: false`; else `true`  |
| `turbo_overlay_close?`                | `false` only when the link opened with `close_button: false`; else `true` |
| `modal_link_to(name, path, overlay_id:, close_button:, hint:, hint_url:)` | `link_to` that opens the target as a stacked modal; `hint:` / `hint_url:` add a hover preview |
| `drawer_link_to(name, path, overlay_id:, position:, backdrop:, close_button:, hint:, hint_url:)` | `link_to` that opens the target as a stacked drawer |
| `popover_link_to(name, path, overlay_id:, position:, align:, offset:, close_button:, hint:, hint_url:)` | `link_to` that opens the target as a popover anchored to the link |
| `hint_link_to(name, path, hint_url:)`   | plain `link_to` decorated with hint data attributes (no overlay opening) |
| `modal_dismiss_link_to(...)`            | dismiss link inside a modal                                            |
| `drawer_dismiss_link_to(...)`           | dismiss link inside a drawer                                           |
| `popover_dismiss_link_to(...)`          | dismiss link inside a popover                                          |
| `overlay_stack_tag`                     | emits the host-page stack container (drop in `application.html.erb`)   |
| `overlay_title(value, &block)`          | sets `content_for :overlay_title`                                      |
| `overlay_footer(value, &block)`         | sets `content_for :overlay_footer`                                     |
| `overlay_close(show = true)`            | toggle the chrome's default close button for this render (`overlay_close false` to hide) |
| `turbo_stream.overlay(:close, scope:, type:, id:)` | turbo-stream action; closes top, all, or one overlay        |

## Themes

| Theme        | Modal | Drawer | Popover | Hint | Notes                                                       |
|--------------|:-----:|:------:|:-------:|:----:|-------------------------------------------------------------|
| `plain`      | ✓     | ✓      | ✓       | ✓    | Native `<dialog>`, minimal vanilla CSS                      |
| `tailwind`   | ✓     | ✓      | ✓       | ✓    | Native `<dialog>`, Tailwind classes                         |
| `bootstrap5` | ✓     | ✓      | ✓       | ✓    | Native `<dialog>` wrapping BS5 modal/offcanvas/popover markup |
| `bootstrap3` | ✓     | ✓      | ✓       | ✓    | Native `<dialog>` wrapping BS3 modal/popover markup; vanilla drawer |

Every theme uses the same JavaScript and CSS — the only thing that
varies is the chrome partial Rails renders inside the dialog. Pick a
theme via `config.theme = :tailwind` and you're done; no file copying
required. Bootstrap themes keep BS's visual classes inside the dialog
so they fit a Bootstrap app, but they don't depend on
`window.bootstrap` or jQuery — the `<dialog>` element drives
open/close, stacking, and focus management. Drawers ship with
slide-in/out animations; modals fade and scale. Animations honor
`prefers-reduced-motion: reduce`.

**Stacking** is handled by the browser's `<dialog>` top-layer for
every theme — no z-index management required.

## Architecture

A single host-page stack container (`<div id="turbo_overlay_stack">`)
receives appended overlays. Each opened overlay is wrapped in its own
`<turbo-frame id="turbo_overlay_<type>_<id>">` so forms inside it can
re-render in place via standard Turbo frame scoping.

When you click `<%= modal_link_to "Edit", edit_user_path(@user) %>`:

1. Turbo issues a `data-turbo-stream="true"` fetch. A small JS hook
   adds `X-Turbo-Overlay: modal` and (if you supplied `overlay_id:`)
   `X-Turbo-Overlay-Id` request headers.
2. The controller concern's `before_action` reads `X-Turbo-Overlay`,
   sets `request.variant = :modal`, and forces html template
   resolution.
3. Rails picks `edit.html+modal.erb` if it exists, else
   `edit.html.erb`.
4. `resolve_layout` returns `modal_layout_name`. The modal layout
   wraps the view in `<turbo-stream action="append" target="turbo_overlay_stack">`
   whose template contains a `<turbo-frame id="turbo_overlay_modal_<id>">`
   wrapping the dialog.
5. The concern's `after_action` sets the response Content-Type to
   `text/vnd.turbo-stream.html` so Turbo processes the stream tag.
6. Turbo appends the new turbo-frame into the stack.
7. The per-dialog `turbo-overlay` Stimulus controller registers with
   the stack controller and opens the dialog.

When a form inside an overlay submits:

1. Turbo scopes the request to the enclosing turbo-frame
   (`turbo_overlay_modal_<id>`) and includes that frame id in the
   `Turbo-Frame` header.
2. On success the controller responds with a turbo-stream containing
   `turbo_stream.overlay(:close)` (and any host-page updates).
3. On validation failure (`render :new, status: :unprocessable_entity`),
   the layout detects the frame request and wraps the response in
   `<turbo-frame id="turbo_overlay_modal_<id>">` — Turbo replaces the
   frame contents in place, the overlay stays open, and the per-dialog
   Stimulus controller short-circuits its open path on reconnect so
   the dialog isn't double-opened.

## Development

```bash
bundle install
bundle exec rake test            # Ruby suite
node --test test/js/*.test.js    # JS pure-function tests
```

## License

MIT — see `LICENSE.txt`.
