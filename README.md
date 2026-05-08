# Turbo Overlay

Render any Rails view inside a modal or drawer using Turbo Frames —
without duplicating templates, hand-rolling Stimulus controllers, or
coupling your domain to a CSS framework.

Each overlay type owns one turbo-frame on the host page. The gem
detects requests targeting those frames, swaps in the matching layout,
exposes a Rails request variant for view-level customization, and
ships a polymorphic turbo-stream action for dismissing whichever
overlay is open.

Themes for **Tailwind**, **Bootstrap 5**, **Bootstrap 3** (modal only),
and **plain CSS** are installable via generators.

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
- Copies the matching Stimulus controllers (auto-registered as
  `turbo-modal` / `turbo-drawer` by stimulus-loading's eager-load
  convention; if your app doesn't use it, the generator injects
  explicit `application.register` calls).
- Injects `<%= overlay_frame_tags %>` before `</body>` in
  `app/views/layouts/application.html.erb`. That single helper emits
  one receiving turbo-frame per configured overlay type, so the
  layout doesn't change as you add or remove overlay types.
- Writes an initializer at `config/initializers/turbo_overlay.rb` (on
  the first run; subsequent installs leave it alone).
- Re-running is idempotent — files already in place are skipped.

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
those; the overlay frame is updated within them.

## Usage

### Open a view in a modal or drawer

```erb
<%= modal_link_to  "New User",   new_user_path %>
<%= drawer_link_to "Filters",    filters_path %>
```

The link targets the matching frame, the controller renders the
normal `new` / index action, and the response is wrapped in the
matching layout. Both can be open at the same time — they live in
separate frames.

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

`overlay_title` and `overlay_footer` are thin convenience wrappers over
`content_for(:overlay_title, …)` and `content_for(:overlay_footer, …)`.

### Different markup for modal / drawer / full-page renders

Drop variant templates alongside the standard one:

```
app/views/users/show.html.erb        # full-page version
app/views/users/show.html+modal.erb  # rendered when opened in a modal
app/views/users/show.html+drawer.erb # rendered when opened in a drawer
```

When the request hits via an overlay frame, Rails picks the matching
variant. No conditionals needed.

### Close the overlay on a successful submission

Return a turbo_stream response that lists what should happen — flash,
parent updates, overlay close — all in one place. The close action
is polymorphic; it dismisses whichever overlay (modal or drawer) is
currently open:

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
            turbo_stream.overlay(:close)
          ]
        end
        format.html { redirect_to @user }
      end
    else
      render :new, status: :unprocessable_entity
    end
  end
end
```

`turbo_stream.overlay(:close)` emits a `<turbo-stream action="overlay" message="close">`
tag. The Stimulus controller dispatches a `turbo-overlay:close` event on
`window`; every open overlay (modal today, drawer in v0.2) listens for it
via `data-action="turbo-overlay:close@window->turbo-modal#close"` and
dismisses cleanly. The action is intentionally polymorphic — an "I'm done,
close the overlay I was in" signal that the server doesn't have to
parameterize by overlay type.

> **Closing is always explicit.** This gem does *not* auto-close on
> `turbo:submit-end`. A successful submission only closes the overlay
> if the response includes `turbo_stream.overlay(:close)`. That avoids
> surprise dismissals when a form inside the overlay should leave it
> open (wizard step, search, inline edit).

On validation failure, just `render :new, status: :unprocessable_entity` —
the overlay layout wraps it (and Rails picks `new.html+modal.erb` /
`new.html+drawer.erb` if you have one), so the form re-renders inside
the open overlay showing errors.

## Configuration

```ruby
# config/initializers/turbo_overlay.rb
TurboOverlay.configure do |config|
  config.modal do |m|
    m.frame_id            = "turbo_modal"  # the host-page frame id
    m.variant             = :modal         # Rails request variant
    m.layout_name         = "turbo_modal"  # layout file name
    m.stimulus_identifier = "turbo-modal"  # Stimulus controller name
  end

  config.drawer do |d|
    d.frame_id            = "turbo_drawer"
    d.variant             = :drawer
    d.layout_name         = "turbo_drawer"
    d.stimulus_identifier = "turbo-drawer"
    d.position            = :right         # :left, :right, :top, :bottom
  end
end
```

## Helpers

Available on controllers (when the concern is included) and views:

| Helper                          | Returns                                                 |
|---------------------------------|---------------------------------------------------------|
| `modal_request?`                | `true` if the current request targets the modal frame   |
| `drawer_request?`               | `true` if the current request targets the drawer frame  |
| `overlay_request?`              | `true` if the current request targets *any* overlay frame |
| `modal_frame_id` / `modal_layout_name` | configured modal frame id / layout name          |
| `drawer_frame_id` / `drawer_layout_name` | configured drawer frame id / layout name       |
| `modal_link_to(...)`            | `link_to` that targets the modal frame                  |
| `drawer_link_to(...)`           | `link_to` that targets the drawer frame                 |
| `modal_dismiss_link_to(...)`    | dismiss link inside a modal                             |
| `drawer_dismiss_link_to(...)`   | dismiss link inside a drawer                            |
| `overlay_frame_tags(*types)`    | emits receiving turbo-frames for the host layout (defaults to all configured types) |
| `overlay_title(value, &block)`  | sets `content_for :overlay_title`                       |
| `overlay_footer(value, &block)` | sets `content_for :overlay_footer`                      |
| `turbo_stream.overlay(:close)`  | turbo-stream action that closes any open overlay        |

## Themes

| Theme        | Modal | Drawer | Notes                                                |
|--------------|:-----:|:------:|------------------------------------------------------|
| `tailwind`   | ✓     | ✓      | Native `<dialog>`, Tailwind classes, no JS framework |
| `bootstrap5` | ✓     | ✓      | BS5 modal / offcanvas, requires `window.bootstrap`   |
| `bootstrap3` | ✓     | —      | BS3 modal, requires jQuery (no native drawer)        |
| `plain`      | ✓     | ✓      | Native `<dialog>`, minimal vanilla CSS               |

The generators copy the chosen theme's layout and Stimulus controller
into your app. All copied files are yours — edit, rename, restyle as
needed.

If you skip the generators, the gem ships engine-level `plain`
layouts for both modal and drawer that work out of the box.

## Architecture

Each overlay type owns one `<turbo-frame>` on the host page (emitted
by `overlay_frame_tags`). Modal and drawer are completely independent
— they can be open simultaneously, dismissed independently, and
swapped via the same turbo_stream close action.

When you click `<%= modal_link_to "Edit", edit_user_path(@user) %>`:

1. Turbo issues a fetch with `Turbo-Frame: turbo_modal`.
2. The controller concern's `before_action` matches the frame id
   against the configured overlay types and sets
   `request.variant = :modal`.
3. Rails picks `edit.html+modal.erb` if it exists, else `edit.html.erb`.
4. The `resolve_layout` method returns `modal_layout_name`. Rails
   wraps the view in the modal layout, which wraps everything in
   `<turbo-frame id="turbo_modal">`.
5. Turbo morphs the response into the page's `<turbo-frame
   id="turbo_modal">`.
6. The Stimulus controller (now connected to the new dialog) opens it.

The drawer flow is identical with `turbo_drawer` / `:drawer` /
`drawer_layout_name`.

When the form inside submits:

1. Turbo posts the form.
2. On success, the controller responds with a turbo_stream listing
   the side effects: parent-frame replacements, flash update, and
   `turbo_stream.overlay(:close)`. The custom action dispatches a
   `turbo-overlay:close` event on `window`; modal and drawer
   Stimulus controllers both listen for it via
   `data-action="turbo-overlay:close@window->turbo-modal#close"` (or
   `turbo-drawer#close`). The action is intentionally polymorphic —
   the server doesn't have to know which overlay type was on screen.
3. On validation failure, the action re-renders the form (with
   `status: :unprocessable_entity`). Because the request still targets
   the same overlay frame, the matching overlay layout wraps it
   again — the overlay stays open with errors.

## Development

```bash
bundle install
bundle exec rake test
```

## License

MIT — see `LICENSE.txt`.
