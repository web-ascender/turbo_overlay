# Hover hints

Hover over a link, get a small preview popover. The hint shows after
a short hover (default 250ms) and dismisses on mouseout (with a grace
window so the user can move into the hint to read or click). Combines
with Turbo's hover prefetch so the same fetch that warms the
navigation also seeds the hint — **single fetch, two purposes**.

## The `+hint` variant template

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

**Plain links** (no `data-turbo-stream`) ride Turbo's hover prefetch.
Drop a `show.html+hint.erb` on the destination page and you're done.

**Overlay links** (`modal_link_to` / `drawer_link_to` /
`popover_link_to`) carry `data-turbo-stream="true"`, which Turbo's
hover prefetch **ignores**. For these, provide an explicit `hint_url:`
that the gem fetches with the `:hint` request variant on hover. Rails
resolves the same `+hint` variant template; the gem's `turbo_overlay/hint`
layout wraps it in `<template id="turbo-overlay-hint">` for the JS
extractor.

```erb
<%# anywhere — both work, both show the same hint body %>
<%= hint_link_to "Open", client_root_path(@client) %>
<%= modal_link_to "Agency view", agency_client_path(@client),
                  hint: true, hint_url: client_root_path(@client) %>
```

## Pending placeholder while the hint loads

After `show_delay_ms`, if the hint content isn't cached yet, the gem
paints a pending placeholder (cloned from the hint-chrome wrapping of
`_loading.html.erb`, or `_loading.html+hint.erb` if you've added
one) so the user sees feedback while the prefetch or `hint_url:`
fetch is in flight. When the real content lands the placeholder
swaps in place — no flicker. If the response carries no hint
template (or the request errored out), the placeholder dismisses
silently.

This fixes a race that used to bite slow controllers: if the response
arrived after `show_delay_ms`, the user would never see a hint until
the next hover hit the cache.

## Prefetch-disabled sites

If the site sets `<meta name="turbo-prefetch" content="false">`, or
the link / an ancestor has `data-turbo-prefetch="false"`, Turbo
won't prefetch for the gem to piggy-back on. The hint module detects
these opt-outs and falls back to a plain `fetch()` of the URL — same
shape Turbo's prefetch would have used, so an existing `+hint`
variant template keeps working without any extra config.

## Negative caching

When a hint-marked URL is fetched and the response has no
`<template id="turbo-overlay-hint">` (or the fetch errors), the gem
caches a `NO_HINT` sentinel for that URL. Subsequent hovers
short-circuit at the show-delay tick: no placeholder is painted, no
fetch is repeated. The negative cache clears on `turbo:visit`, so a
page navigation gives the gem a fresh chance to discover a hint.

## Touch, accessibility, and dismissal

- **Touch devices** (`(hover: none)`) are detected at `connect` and
  the controller short-circuits — no hint behavior, no listeners.
- **Keyboard accessibility**: focusing a hint-marked link shows the
  hint after the same delay; blurring it starts the grace timer.
  The hint element gets a `role="tooltip"` and is linked to the
  trigger via `aria-describedby` while visible.
- **Dismissal**: mouseout (with grace), focusout (with grace), ESC,
  Turbo navigation (`turbo:visit`), or any click intercepted by Turbo
  (`turbo:click`). Hints don't participate in the overlay stack —
  they dismiss purely client-side.

## Redirects

If `users/42` redirects to `profiles/42`, the gem caches the
extracted fragment under **both** URLs so hovering either link in
the same page lifetime resolves to the same hint without a refetch.

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

Hints are inert on pages without `data-turbo-overlay-hint` markers,
so the module is free to leave enabled even for apps that don't use
hover previews.
