# Turbo Overlay

Render any Rails view inside a stackable modal or drawer using Turbo
Streams — without duplicating templates, hand-rolling Stimulus
controllers, or coupling your domain to a CSS framework.

A single stack container on the host page receives appended overlays.
The gem detects overlay-bound requests, swaps in the matching layout,
exposes a Rails request variant for view-level customization, and
ships a turbo-stream action for dismissing whichever overlay is open
— or all of them.

**Overlays stack.** Open a modal/drawer from inside an open one and
the new overlay slides on top instead of replacing it. Dismissing
affects only the topmost layer.

Themes for **Tailwind**, **Bootstrap 5**, **Bootstrap 3** (modal only),
and **plain CSS** are installable via generators.

## Requirements

- Rails ≥ 6.1
- turbo-rails ≥ 2.0 (Turbo 8) — required for `data-turbo-stream="true"` on GET links

## Installation

Add to your Gemfile:

```ruby
gem "turbo_overlay"
```

Then run the install generator. By default it installs both modal and
drawer; pass `--skip-modal` or `--skip-drawer` if you only want one:

```bash
bundle install

# both modal + drawer (default)
bin/rails generate turbo_overlay:install --theme tailwind

# modal only
bin/rails generate turbo_overlay:install --theme tailwind --skip-drawer

# drawer only
bin/rails generate turbo_overlay:install --theme tailwind --skip-modal
```

Themes: `tailwind`, `bootstrap5`, `bootstrap3`, `plain`. Bootstrap 3
has no native drawer/offcanvas, so passing `--theme bootstrap3`
auto-skips the drawer install with a notice.

The generator:

- Copies the overlay layouts you selected (e.g.
  `app/views/layouts/turbo_modal.html.erb`,
  `app/views/layouts/turbo_drawer.html.erb`).
- Copies two Stimulus controllers — `turbo_overlay_stack_controller.js`
  (the host-page stack registry) and `turbo_overlay_controller.js`
  (the per-overlay controller, theme-agnostic). Auto-registered as
  `turbo-overlay-stack` and `turbo-overlay` by stimulus-loading's
  eager-load convention; if your app doesn't use it, the generator
  injects explicit `application.register` calls.
- Injects `<%= turbo_overlay_styles %>` into `<head>` and
  `<%= overlay_stack_tag %>` before `</body>` in
  `app/views/layouts/application.html.erb`. The styles helper emits
  the gem's CSS once per page load, so layouts don't ship a
  `<style>` block with every overlay response.
- Writes an initializer at `config/initializers/turbo_overlay.rb` (on
  the first run; subsequent installs leave it alone).
- Re-running is idempotent — files already in place are skipped. Pass
  `--force` to overwrite when upgrading.

You own all the copied files — customize freely.

The one remaining step is `ApplicationController`. Include the
controller concern and add a layout method that swaps to the matching
overlay layout per request:

```ruby
class ApplicationController < ActionController::Base
  include TurboOverlay::Controller
  layout :resolve_layout

  private

  def resolve_layout
    return modal_layout_name  if modal_request?
    return drawer_layout_name if drawer_request?
    "application"
  end
end
```

The overlay layout **replaces** your application layout for overlay
requests — only the view content is wrapped in the dialog/drawer
markup, not your nav, header, or footer. The host page already has
those; the appended overlay sits on top.

## Usage

### Open a view in a modal or drawer

```erb
<%= modal_link_to  "New User",   new_user_path %>
<%= drawer_link_to "Filters",    filters_path %>
```

Both can be open at the same time. Both can be opened from inside
another overlay — they stack. Dismissing closes only the top.

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
the controller and views you can read it as `current_overlay_id` —
useful for closing the overlay you're currently rendering after a
side-effect:

```ruby
render turbo_stream: turbo_stream.overlay(:close, id: current_overlay_id)
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

### Different markup for modal / drawer / full-page renders

Drop variant templates alongside the standard one:

```
app/views/users/show.html.erb        # full-page version
app/views/users/show.html+modal.erb  # rendered when opened in a modal
app/views/users/show.html+drawer.erb # rendered when opened in a drawer
```

When the request hits via an overlay, Rails picks the matching variant.

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
turbo_stream.overlay(:close, id: "edit_user_42")          # close one specific
```

> **Closing is always explicit.** This gem does *not* auto-close on
> `turbo:submit-end`. A submission only closes the overlay if the
> response includes `turbo_stream.overlay(:close, …)`. That avoids
> surprise dismissals when a form inside the overlay should leave it
> open (wizard step, search, inline edit).

On validation failure, just `render :new, status: :unprocessable_entity`.
The form lives inside a per-overlay turbo-frame, so Rails re-renders
the form and Turbo replaces the frame's contents in place — the
overlay stays open and shows errors. No special handling required.

## Configuration

```ruby
# config/initializers/turbo_overlay.rb
TurboOverlay.configure do |config|
  config.stack_id = "turbo_overlay_stack"  # host-page stack container DOM id

  config.modal do |m|
    m.variant             = :modal         # Rails request variant
    m.layout_name         = "turbo_modal"  # layout file name
    m.stimulus_identifier = "turbo-overlay"
  end

  config.drawer do |d|
    d.variant             = :drawer
    d.layout_name         = "turbo_drawer"
    d.stimulus_identifier = "turbo-overlay"
    d.position            = :right         # :left, :right, :top, :bottom
  end
end
```

## Helpers

Available on controllers (when the concern is included) and views:

| Helper                                  | Returns                                                                |
|-----------------------------------------|------------------------------------------------------------------------|
| `modal_request?` / `drawer_request?`    | `true` if the current request targets that overlay type                |
| `overlay_request?`                      | `true` if the current request targets *any* overlay                    |
| `current_overlay_type`                  | `:modal`, `:drawer`, or `nil`                                          |
| `current_overlay_id`                    | The overlay id for the current request (user-supplied or generated)    |
| `modal_link_to(name, path, overlay_id:)` | `link_to` that opens the target as a stacked modal                    |
| `drawer_link_to(name, path, overlay_id:)` | `link_to` that opens the target as a stacked drawer                  |
| `modal_dismiss_link_to(...)`            | dismiss link inside a modal                                            |
| `drawer_dismiss_link_to(...)`           | dismiss link inside a drawer                                           |
| `overlay_stack_tag`                     | emits the host-page stack container (drop in `application.html.erb`)   |
| `turbo_overlay_styles`                  | emits the gem's default stylesheet as a single `<style>` tag (drop in `<head>`) |
| `overlay_title(value, &block)`          | sets `content_for :overlay_title`                                      |
| `overlay_footer(value, &block)`         | sets `content_for :overlay_footer`                                     |
| `turbo_stream.overlay(:close, scope:, type:, id:)` | turbo-stream action; closes top, all, or one overlay        |

## Themes

| Theme        | Modal | Drawer | Notes                                                       |
|--------------|:-----:|:------:|-------------------------------------------------------------|
| `tailwind`   | ✓     | ✓      | Native `<dialog>`, Tailwind classes                         |
| `bootstrap5` | ✓     | ✓      | Native `<dialog>` wrapping BS5 modal/offcanvas markup       |
| `bootstrap3` | ✓     | ✓      | Native `<dialog>` wrapping BS3 modal markup; vanilla drawer |
| `plain`      | ✓     | ✓      | Native `<dialog>`, minimal vanilla CSS                      |

Every theme uses the same JavaScript controller. The Bootstrap themes
keep BS's visual classes inside the dialog so they fit a Bootstrap
app, but they don't depend on `window.bootstrap` or jQuery — the
`<dialog>` element drives open/close, stacking, and focus management.
Drawers ship with slide-in/out animations; modals fade and scale.
Animations honor `prefers-reduced-motion: reduce`.

The generators copy the chosen theme's layout and Stimulus controller
into your app. All copied files are yours — edit, rename, restyle as
needed.

If you skip the generators, the gem ships engine-level `plain`
layouts for both modal and drawer that work out of the box.

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
bundle exec rake test
```

## License

MIT — see `LICENSE.txt`.
