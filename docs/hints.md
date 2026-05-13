# Hover hints

Hover over a link, get a small preview popover. The hint shows after
a short hover (default 250ms) and dismisses on mouseout (with a grace
window so the user can move into the hint to read or click). When
Turbo prefetches the link on hover, the same fetch seeds the hint.

## The `+hint` variant template

Provide hint content as a `+hint` variant template next to the
action's regular template:

```erb
<%# app/views/users/show.html+hint.erb %>
<h3><%= @user.name %></h3>
<p>Last seen <%= time_ago_in_words(@user.last_seen_at) %> ago</p>
```

```erb
<%# anywhere — make a link show that hint on hover %>
<%= hint_link_to "User", user_path(@user) %>
```

The variant only renders on hintable requests (Turbo prefetch or
explicit `:hint` fetch), so regular page renders don't pay for it.

## Compose with overlay link helpers

`hint:` / `hint_url:` work on every overlay helper:

```erb
<%= modal_link_to   "Edit", edit_user_path(@user),
                    hint: true, hint_url: hint_user_path(@user) %>
<%= drawer_link_to  "Filters", filters_path,
                    hint: true, hint_url: hint_filters_path %>
<%= popover_link_to "Edit", edit_user_path(@user),
                    hint: true, hint_url: hint_user_path(@user) %>
```

Or via plain `link_to`:

```erb
<%= link_to "User", user_path(@user),
            data: { turbo_overlay_hint: true,
                    turbo_overlay_hint_url: hint_user_path(@user) } %>
```

## Plain links vs overlay links

**Plain links** ride Turbo's hover prefetch — drop a
`show.html+hint.erb` on the destination and you're done.

**Overlay links** aren't prefetched by Turbo. Pass `hint_url:` and
the gem fetches it on hover with the `:hint` request variant, which
resolves the same `+hint` template:

```erb
<%= modal_link_to "Agency view", agency_client_path(@client),
                  hint: true, hint_url: client_root_path(@client) %>
```

## Pending placeholder while the hint loads

If the hint isn't cached yet at `show_delay_ms`, the gem paints a
placeholder while the fetch is in flight. When the real content
lands, the placeholder swaps in place. If the response has no hint
template (or errors), the placeholder dismisses silently.

Customize it with `_loading.html+hint.erb`.

## Prefetch-disabled sites

If the site sets `<meta name="turbo-prefetch" content="false">`, or
the link / an ancestor has `data-turbo-prefetch="false"`, the gem
fetches the URL itself on hover — `+hint` templates keep working
without extra config.

## Accessibility and dismissal

- **Touch devices** (`(hover: none)`) are skipped — no hints, no
  listeners.
- **Keyboard**: focusing a hint-marked link shows the hint after the
  same delay; blurring starts the grace timer. The hint gets
  `role="tooltip"` and is linked to the trigger via
  `aria-describedby` while visible.
- **Dismissal**: mouseout (with grace), focusout (with grace), ESC,
  Turbo navigation, or any click intercepted by Turbo.

## Tuning the delays

```ruby
TurboOverlay.configure do |config|
  config.hint.show_delay_ms = 400   # default 250
  config.hint.hide_delay_ms = 200   # default 120
end
```

Individual links can override either delay with `show_delay:` /
`hide_delay:` (milliseconds):

```erb
<%= hint_link_to "User", user_path(@user), show_delay: 600 %>
<%= modal_link_to "Edit", edit_user_path(@user),
                  hint: true, hint_url: hint_user_path(@user),
                  show_delay: 600 %>
```

Useful for dense datatables and menus where a longer show delay
keeps hints from flickering during scroll or keyboard navigation,
or for a single high-signal link that wants a near-zero delay.
