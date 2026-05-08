# Turbo Overlay

Render any Rails view inside a modal using Turbo Frames — without
duplicating templates, hand-rolling Stimulus controllers, or coupling your
domain to a CSS framework.

A single turbo-frame on the host page captures modal-bound links. The gem
detects those requests, swaps in a modal layout, exposes a Rails request
variant for view-level customization, and ships a custom turbo-stream
action plus Stimulus controller for dismissing the modal on demand.

Themes for **Tailwind**, **Bootstrap 5**, **Bootstrap 3**, and **plain CSS**
are installable via generator. The gem itself is theme-agnostic: install
one, write your own, or mix and match.

> **Drawer support is planned for v0.2.** The public API uses `modal_*`
> naming today (`modal_link_to`, request variant `:modal`) so adding a
> parallel `drawer_*` API in v0.2 won't break existing apps. The
> turbo-stream close action and in-view content helpers stay generic
> (`turbo_stream.overlay(:close)`, `overlay_title`) — they don't need to
> know which overlay type is on screen.

## Installation

Add to your Gemfile:

```ruby
gem "turbo_overlay"
```

Then run the install generator and pick a theme:

```bash
bundle install
bin/rails generate turbo_overlay:install --theme tailwind
# or: bootstrap5 / bootstrap3 / plain
```

The generator:

- Copies the modal layout to `app/views/layouts/turbo_modal.html.erb`.
- Copies the Stimulus controller to `app/javascript/controllers/turbo_modal_controller.js`
  (auto-registered as `turbo-modal` by stimulus-loading's eager-load
  convention; if your app doesn't use it, the generator injects an
  explicit `application.register` call).
- Injects `<%= turbo_frame_tag "turbo_modal" %>` before `</body>` in
  `app/views/layouts/application.html.erb`.
- Writes an initializer at `config/initializers/turbo_overlay.rb`.

You own all the copied files — customize freely.

The one remaining step is `ApplicationController`. Include the controller
concern and add a layout method that swaps to the modal layout for modal
requests:

```ruby
class ApplicationController < ActionController::Base
  include TurboOverlay::Controller
  layout :resolve_layout

  private

  def resolve_layout
    modal_request? ? modal_layout_name : "application"
  end
end
```

The modal layout (`turbo_modal`) **replaces** your application layout for
modal requests — only the view content is wrapped in the dialog markup,
not your nav, header, or footer. The host page already has those; the
modal frame is updated within them.

## Usage

### Open a view in a modal

```erb
<%= modal_link_to "New User", new_user_path %>
```

That's it. The link targets the modal frame, the controller renders the
normal `new` action, and the response is wrapped in the modal layout.

### Customize what the modal renders

The layout yields a body and reads two optional `content_for` blocks via
generic helpers. The keys (`:overlay_title`, `:overlay_footer`) are
intentionally generic so views also work cleanly in v0.2 drawers.

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

### Different markup for modal vs. full-page renders

Drop a variant template alongside the standard one:

```
app/views/users/show.html.erb       # full-page version
app/views/users/show.html+modal.erb # modal version
```

When the request hits via the modal frame, Rails picks `show.html+modal.erb`.
No conditionals needed.

### Close the modal on a successful submission

Return a turbo_stream response that lists what should happen — flash,
parent updates, modal close — all in one place:

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
> `turbo:submit-end`. A successful submission only closes the modal if
> the response includes `turbo_stream.overlay(:close)`. That avoids surprise
> dismissals when a form inside the modal should leave it open
> (wizard step, search, inline edit).

On validation failure, just `render :new, status: :unprocessable_entity` —
the modal layout wraps it (and Rails picks `new.html+modal.erb` if you
have one), so the form re-renders inside the open modal showing errors.

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
  # v0.2 will add `config.drawer do |d| ... end`
end
```

## Helpers

Available on controllers (when the concern is included) and views:

| Helper                          | Returns                                          |
|---------------------------------|--------------------------------------------------|
| `modal_request?`                | `true` if the current request targets the modal frame |
| `modal_frame_id`                | the configured modal frame id (overridable)      |
| `modal_link_to(...)`            | `link_to` that targets the modal frame           |
| `modal_dismiss_link_to(...)`    | dismiss link inside the modal                    |
| `overlay_title(value, &block)`  | sets `content_for :overlay_title`                |
| `overlay_footer(value, &block)` | sets `content_for :overlay_footer`               |
| `turbo_stream.overlay(:close)`  | turbo-stream action that closes any open overlay |

## Themes

Four themes ship with the install generator:

- **`tailwind`** — native `<dialog>`, Tailwind classes, no JS framework dep
- **`bootstrap5`** — Bootstrap 5 modal markup, requires `window.bootstrap`
- **`bootstrap3`** — Bootstrap 3 modal markup, requires jQuery
- **`plain`** — native `<dialog>`, minimal vanilla CSS

The generator copies the chosen theme's layout and Stimulus controller into
your app. Both files are yours — edit, rename, restyle as needed.

If you skip the generator, the gem ships an engine-level `plain` layout that
works out of the box.

## Architecture

When you click `<%= modal_link_to "Edit", edit_user_path(@user) %>`:

1. Turbo issues a fetch with `Turbo-Frame: turbo_modal` in the headers.
2. The controller concern's `before_action` sets `request.variant = :modal`.
3. Rails picks `edit.html+modal.erb` if it exists, else `edit.html.erb`.
4. The configured layout (`modal_layout`) wraps the view in the modal
   layout — which itself wraps everything in `<turbo-frame id="turbo_modal">`.
5. Turbo morphs the response into the page's `<turbo-frame id="turbo_modal">`.
6. The Stimulus controller (now connected to the new dialog/modal) opens it.

When the form inside submits:

1. Turbo posts the form.
2. On success, the controller responds with a turbo_stream listing the
   side effects: parent-frame replacements, flash update, and
   `turbo_stream.overlay(:close)`. The custom action dispatches a
   `turbo-overlay:close` event on `window`; the Stimulus controller
   dismisses the dialog and the framework theme cleans up its own state.
3. On validation failure, the action re-renders the form (with `status:
   :unprocessable_entity`). Because the request still targets the modal
   frame, the modal layout wraps it again — the modal stays open with
   errors.

## Development

```bash
bundle install
bundle exec rake test
```

## License

MIT — see `LICENSE.txt`.
