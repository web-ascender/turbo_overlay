# Turbo Overlay

Render any Rails view inside a stackable modal, drawer, or popover
using Turbo Streams — without duplicating templates, hand-rolling
Stimulus controllers, or coupling your domain to a CSS framework.

- **Four overlay types**: modal, drawer, popover, hover hint.
- **Stacking by default.** Open an overlay from inside another and the
  new one slides on top instead of replacing it. Dismissal affects
  only the topmost layer.
- **Themes ship in the gem** for Tailwind, Bootstrap 5, Bootstrap 3,
  and plain CSS. Switch with one config option.
- **Native `<dialog>`** for every theme — top-layer stacking, focus
  trap, ESC/backdrop dismiss come from the browser. No `window.bootstrap`,
  no jQuery, no z-index wars.
- **Hover hints** with Turbo prefetch coordination. One fetch warms the
  navigation *and* seeds a preview popover.
- **Themed `data-turbo-confirm`** prompts that match your overlay look
  and stack like one.

## Requirements

- Rails ≥ 6.1
- turbo-rails ≥ 2.0 (Turbo 8) — required for `data-turbo-stream="true"` on GET links

## Installation

```ruby
# Gemfile
gem "turbo_overlay"
```

```bash
bundle install
bin/rails generate turbo_overlay:install --theme tailwind
```

Themes: `plain` (default), `tailwind`, `bootstrap5`, `bootstrap3`.

The generator wires the host app: it copies the theme's chrome
partials into `app/views/turbo_overlay/`, writes
`config/initializers/turbo_overlay.rb`, injects `overlay_stack_tag`
into your application layout, and registers the Stimulus / asset
wiring appropriate to your build setup (importmap, propshaft,
sprockets, jsbundling, cssbundling).

The final wiring step is your `ApplicationController`. Include the
concern:

```ruby
class ApplicationController < ActionController::Base
  include TurboOverlay::Controller
end
```

Including the concern installs a `layout` proc that swaps to the
matching overlay layout on overlay requests. Plain turbo-frame
requests keep their turbo-rails layout.

Overlay layouts **replace** your application layout for overlay
requests — only the view content is wrapped in the dialog markup,
not your nav, header, or footer.

### Custom layouts

If your controller uses its own layout method, call
`turbo_overlay_layout` from it:

```ruby
layout :custom_layout

def custom_layout
  turbo_overlay_layout || "my_app_layout"
end
```

A static `layout "admin"` declaration needs to be a method to thread
`turbo_overlay_layout` through.

If you skip the install generator the gem falls back to a plain
`<dialog>` chrome so modals and drawers still work, just unstyled
beyond the gem's CSS.

See [docs/installation.md](docs/installation.md) for the full
install generator output, bundling-app setup, and the `eject`
generator.

## Usage

### Open a view in an overlay

```erb
<%= modal_link_to   "New User",   new_user_path %>
<%= drawer_link_to  "Filters",    filters_path %>
<%= popover_link_to "Edit",       edit_user_path(@user) %>
```

Modals and drawers stack. Popovers anchor to the trigger and replace
each other; modals and drawers still stack on top of an open popover.
See [docs/popovers.md](docs/popovers.md) for per-link options
(`position:`, `align:`, `offset:`, `backdrop:`) and the
single-popover behavior.

### Customize what the overlay renders

The chrome yields a body and reads two `content_for` blocks. The
keys are generic so the same view renders correctly in a modal or
a drawer:

```erb
<%# app/views/users/new.html.erb %>
<%= overlay_title "New User" %>

<%= form_with(model: @user) do |f| %>
  <%= f.text_field :name %>
<% end %>

<%= overlay_footer do %>
  <%= modal_dismiss_link_to "Cancel", users_path, class: "btn btn-secondary" %>
  <button type="submit" class="btn btn-primary">Save</button>
<% end %>
```

Use `<%=` (not `<%`): inside an overlay the helpers capture into
the chrome's header/footer slots and emit nothing inline, but on
a standalone page render they fall back to printing the content
where the tag sits — so one template covers both renders.

Variant templates pick different markup per chrome:

```
app/views/users/show.html.erb          # full-page
app/views/users/show.html+modal.erb    # in a modal
app/views/users/show.html+drawer.erb   # in a drawer
app/views/users/show.html+popover.erb  # in a popover
```

See [docs/customization.md](docs/customization.md) for the
overlay-template footgun, chrome partial structure, close-button
suppression, and stable overlay ids.

### Close the overlay from server code

`turbo_stream.overlay(:close)` closes the top overlay. A submission
only closes the overlay if the response says so — there's no implicit
close on `turbo:submit-end`, so wizard steps and inline edits stay
open by default.

```ruby
def create
  @user = User.new(user_params)

  if @user.save
    render turbo_stream: [
      turbo_stream.update("flash", partial: "shared/flash"),
      turbo_stream.overlay(:close)
    ]
  else
    render :new, status: :unprocessable_entity   # form re-renders in place
  end
end
```

Variants:

```ruby
turbo_stream.overlay(:close)                              # top overlay
turbo_stream.overlay(:close, scope: :all)                 # every open overlay
turbo_stream.overlay(:close, scope: :all, type: :modal)   # all modals
turbo_stream.overlay(:close, id: "edit_user_42")          # specific id
```

On validation failure the overlay stays open and re-renders the
form with errors in place. No special handling required.

ESC and clicking the backdrop dismiss the top overlay out of the
box. Opt a specific overlay out with
`data-turbo-overlay-backdrop-dismiss-value="false"`.

### Loading state, themed confirms, and hover hints

- [docs/loading-and-confirm.md](docs/loading-and-confirm.md) —
  loading placeholders and themed `data-turbo-confirm`.
- [docs/hints.md](docs/hints.md) — hover-preview popovers and the
  `+hint` variant template.

## Themes

| Theme        | Modal | Drawer | Popover | Hint | Notes                                                       |
|--------------|:-----:|:------:|:-------:|:----:|-------------------------------------------------------------|
| `plain`      | ✓     | ✓      | ✓       | ✓    | Native `<dialog>`, minimal vanilla CSS                      |
| `tailwind`   | ✓     | ✓      | ✓       | ✓    | Native `<dialog>`, Tailwind classes                         |
| `bootstrap5` | ✓     | ✓      | ✓       | ✓    | Native `<dialog>` wrapping BS5 modal/offcanvas/popover markup |
| `bootstrap3` | ✓     | ✓      | ✓       | ✓    | Native `<dialog>` wrapping BS3 modal/popover markup; vanilla drawer |

Every theme uses the same JavaScript and CSS — only the chrome
partial Rails renders inside the dialog varies. Animations honor
`prefers-reduced-motion: reduce`. Stacking is handled by the
browser's `<dialog>` top layer regardless of theme.

## Documentation

- [Installation](docs/installation.md) — generator details, bundling
  apps, eject.
- [Popovers](docs/popovers.md) — per-link positioning, single-popover
  behavior, link targeting inside popovers.
- [Hints](docs/hints.md) — hover previews, prefetch coordination,
  the `+hint` variant template.
- [Loading & confirm](docs/loading-and-confirm.md) — loading
  placeholders and themed confirm dialogs.
- [Customization](docs/customization.md) — chrome partials, variant
  templates, stable ids, the full-page-render footgun.
- [Reference](docs/reference.md) — full configuration, helper
  reference, JavaScript events.
- [Accessibility](docs/accessibility.md) — what the gem gives you,
  what you provide, known limitations.
- [Architecture](docs/architecture.md) — request lifecycle, headers,
  hint internals, JS module layout. Optional reading.

## Development

```bash
bundle install
bundle exec rake test            # Ruby suite
node --test test/js/*.test.js    # JS pure-function tests
```

## License

MIT — see `LICENSE.txt`.
