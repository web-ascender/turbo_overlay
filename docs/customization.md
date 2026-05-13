# Customization

## Title and footer slots

The chrome partials yield a body and read two `content_for` blocks
via generic helpers. The keys (`:overlay_title`, `:overlay_footer`)
are intentionally generic so the same view renders correctly in
either a modal or a drawer:

```erb
<%# app/views/users/new.html.erb %>
<% overlay_title "New User" %>

<%= form_with(model: @user) do |f| %>
  <%= f.text_field :name %>
<% end %>

<% overlay_footer do %>
  <%= modal_dismiss_link_to "Cancel", users_path, class: "btn btn-secondary" %>
  <button type="submit" class="btn btn-primary">Save</button>
<% end %>
```

The chrome partials render a default close ("×") button. When the
view sets `overlay_title`, it sits inside the header; without a
title it floats in the top-right corner. Suppress per overlay:

```erb
<%# in the rendered view %>
<% overlay_close false %>

<%# at the call site %>
<%= modal_link_to "Promo", promo_path, close: false %>
```

## Variant templates per chrome

Drop variant templates alongside the standard one:

```
app/views/users/show.html.erb         # full-page version
app/views/users/show.html+modal.erb   # rendered when opened in a modal
app/views/users/show.html+drawer.erb  # rendered when opened in a drawer
app/views/users/show.html+popover.erb # rendered when opened in a popover
```

Rails picks the matching variant on overlay requests.

### Footgun: `overlay_title` / `overlay_footer` in a full-page template

Both helpers write to `content_for` keys (`:overlay_title`,
`:overlay_footer`) that only the overlay chrome partials yield. The
application layout doesn't yield them, so on a full-page render —
e.g. when a user opens the overlay link in a new tab — the title
and *every button inside `overlay_footer`* silently disappear. The
form still posts, but there's no visible submit control.

Two safe patterns:

1. **Use variant templates** (recommended). Put overlay-only chrome
   in `show.html+modal.erb` and keep `show.html.erb` as a standalone
   page with its own header and buttons. The two never share code
   paths.
2. **Branch on `overlay_request?`** inside a single template:

   ```erb
   <% if overlay_request? %>
     <% overlay_title "Edit user" %>
     <%= render "form", user: @user %>
     <% overlay_footer do %>
       <button type="submit" form="user-form" class="btn btn-primary">Save</button>
     <% end %>
   <% else %>
     <h1>Edit user</h1>
     <%= render "form", user: @user %>
     <button type="submit" form="user-form" class="btn btn-primary">Save</button>
   <% end %>
   ```

Either way, make sure every overlay-targeted action also renders
sensibly as a standalone page — "open link in new tab" is a real
user habit, and the URL is a real Rails route.

## Stable ids and closing from server code

Give an overlay an id at open time and close it later from server
code:

```erb
<%= modal_link_to "Edit user",
                  edit_user_path(@user),
                  overlay_id: "edit_user_#{@user.id}" %>
```

```ruby
turbo_stream.overlay(:close, id: "edit_user_#{@user.id}")
```

When `overlay_id:` is omitted, the gem generates a random id.
Inside the controller and views read it as `turbo_overlay_id`:

```ruby
render turbo_stream: turbo_stream.overlay(:close, id: turbo_overlay_id)
```

## Chrome partials

The install generator copies these into your app:

**Chrome partials** (the dialog/wrapper for each overlay type):

- `app/views/turbo_overlay/_modal.html.erb`
- `app/views/turbo_overlay/_drawer.html.erb`
- `app/views/turbo_overlay/_popover.html.erb`
- `app/views/turbo_overlay/_hint.html.erb`

**Body-only partials** (rendered *inside* the matching chrome at
template-emission time by `overlay_stack_tag`):

- `app/views/turbo_overlay/_confirm.html.erb` — shared confirm body,
  wrapped in modal or popover chrome per `config.confirm.style`
- `app/views/turbo_overlay/_loading.html.erb` — shared loading body,
  wrapped in modal/drawer/popover/hint chrome

Both default to a single shared file that works across every chrome
variant. Drop in a chrome-specific override
(`_confirm.html+modal.erb`, `_loading.html+hint.erb`, etc.) when
you need different markup for one variant — the variant lookup
prefers it over the shared file.

These are *your* files. Edit them freely — change classes, add a
brand container, restyle the close button.

**Chrome partials** are rendered as layouts (`render layout: ...`),
so they use `<%= yield %>` for the body and read
`content_for(:overlay_title)` / `content_for(:overlay_footer)` for
the slots. Keep the `<dialog>` element's
`data-controller="turbo-overlay"` and its data values so the
Stimulus controllers can attach. They accept a `loading:` local —
when `true`, the chrome drops the Stimulus controller wiring, close
button, and overlay title/footer slots, and switches the ARIA role
to `status` for the loading placeholder use case.

**Body-only confirm/loading partials** only contain the content that
goes inside the chrome — no `<dialog>` wrapper, no Stimulus
controller. `overlay_stack_tag` does
`render(partial: "turbo_overlay/confirm", layout: "turbo_overlay/<variant>", ...)`
so retheming the chrome carries through to confirm and loading
automatically.

If you delete these files, the gem's plain fallback partials kick
in. To switch themes (e.g. plain → tailwind), re-run install with
`--force`:

```bash
bin/rails g turbo_overlay:install --theme tailwind --force
```

## User-initiated dismissal

Out of the box the user can dismiss the top overlay with **ESC** or
by **clicking the backdrop**. Both go through the same animated
close path as the close button. Opt a specific overlay out of
backdrop-click dismissal — e.g. a form with unsaved input — with:

```erb
<dialog ...
        data-controller="turbo-overlay"
        data-turbo-overlay-backdrop-dismiss-value="false">
```

On validation failure, just
`render :new, status: :unprocessable_entity`. The form lives inside
a per-overlay turbo-frame, so Rails re-renders the form and Turbo
replaces the frame's contents in place — the overlay stays open and
shows errors. No special handling required.

## Closing is always explicit

> **For modals, drawers, and popovers**, this gem does *not*
> auto-close click-opened overlays on `turbo:submit-end`. A
> submission only closes the overlay if the response includes
> `turbo_stream.overlay(:close, …)`. That avoids surprise dismissals
> when a form inside the overlay should leave it open (wizard step,
> search, inline edit).
>
> **Hints are the exception** — they open from hover state and
> dismiss purely client-side on mouseout (with a grace window).
> There's no `turbo_stream.overlay(:close, type: :hint)` path.
