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

## Branching in controllers

The gem sets `request.variant` to `:modal`, `:drawer`, `:popover`, or
`:hint` on overlay requests, and exposes `overlay_request?` plus
per-type predicates (`modal_request?`, `drawer_request?`,
`popover_request?`, `hint_request?`) on both controllers and views.
Use either to fork an action's response.

### `respond_to` with variant blocks

Because `request.variant` is set, standard Rails variant-block API
works out of the box:

```ruby
def show
  @user = User.find(params[:id])

  respond_to do |format|
    format.html.modal   { render :show_modal }
    format.html.drawer  { render :show_drawer }
    format.html         { render :show }  # full-page fallback
  end
end
```

For pure markup differences, [variant templates](#variant-templates-per-chrome)
(`show.html+modal.erb` etc.) are simpler — branch in the action
itself only when you need to load different data or run different
logic per chrome.

### Closing on success, redirecting on failure

The most common controller pattern: a `create`/`update` that closes
the overlay on success when one is open, and falls through to a
normal redirect for full-page callers.

```ruby
def create
  @user = User.new(user_params)

  if @user.save
    if overlay_request?
      render turbo_stream: [
        turbo_stream.overlay(:close, id: turbo_overlay_id),
        turbo_stream.prepend("users", partial: "users/user", locals: { user: @user })
      ]
    else
      redirect_to @user, notice: "Created."
    end
  else
    render :new, status: :unprocessable_entity
  end
end
```

`render :new, status: :unprocessable_entity` works for both overlay
and full-page submissions — Turbo re-renders the form in place
either way, so validation errors don't need a separate code path.

## Chrome partials

The install generator copies these into your app. They're yours —
edit freely.

**Chrome partials** wrap the dialog/drawer/popover/hint:

- `app/views/turbo_overlay/_modal.html.erb`
- `app/views/turbo_overlay/_drawer.html.erb`
- `app/views/turbo_overlay/_popover.html.erb`
- `app/views/turbo_overlay/_hint.html.erb`

When editing a chrome partial, keep the `<dialog>` element with its
`data-controller="turbo-overlay"` and data values, the `<%= yield %>`
for the body, and the `content_for(:overlay_title)` /
`content_for(:overlay_footer)` reads.

The chrome partials accept a `loading:` local; when `true` they
render a static placeholder version (no Stimulus controller, no
close button, no title/footer).

**Body-only partials** render *inside* the matching chrome —
retheming the chrome flows through to both:

- `app/views/turbo_overlay/_confirm.html.erb` — themed
  `data-turbo-confirm` body.
- `app/views/turbo_overlay/_loading.html.erb` — loading placeholder
  body.

Add `_confirm.html+<variant>.erb` or `_loading.html+<variant>.erb`
when you need chrome-specific markup; the variant wins over the
shared file.

To switch themes, re-run install with `--force`:

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
`render :new, status: :unprocessable_entity` — the overlay stays
open and re-renders the form with errors in place. No special
handling required.

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
