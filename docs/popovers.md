# Popovers

`popover_link_to` opens its target as a non-modal `<dialog>` anchored
to the link that was clicked — the same plumbing as modal/drawer, just
positioned relative to its trigger instead of centered or pinned to
an edge.

```erb
<%= popover_link_to "Edit", edit_user_path(@user) %>
```

## Per-link options

```erb
<%= popover_link_to "Edit", edit_user_path(@user),
                    position: :top,    # :top, :bottom (default), :left, :right
                    align:    :center, # :start (default), :center, :end
                    offset:   8 %>     # pixels between trigger and dialog (default 4)
```

Popovers **auto-flip** across the cross axis when the preferred side
would overflow the viewport (e.g. `:bottom` becomes `:top` near the
bottom edge). Disable globally with `config.popover.auto_flip = false`.

## Dismissal

ESC, clicking outside the popover, or any explicit
`turbo_stream.overlay(:close, type: :popover)`. Because popovers are
non-modal, the page beneath stays scrollable and interactive — the
popover repositions itself as the anchor scrolls.

## Single-popover behavior

Opening a second popover automatically dismisses any other open
popover. Modals and drawers still stack as normal — a modal opened
from inside a popover sits on top, and dismissing it leaves the
popover anchored. "Two free-floating popovers at once" is rarely
what you want; if you genuinely need stacked popovers, open an
issue.

## Links inside popovers

A plain `link_to` rendered inside a popover would otherwise navigate
inside the popover's turbo-frame and replace its contents. The
controller back-fills `data-turbo-frame="_top"` on any `<a>` that
doesn't already carry an explicit `data-turbo-frame` or
`data-turbo-overlay` — so a regular link navigates the page (closing
the popover), while `modal_link_to` / `drawer_link_to` /
`popover_link_to` keep their stacking behavior. Forms inside the
popover are untouched and still re-render in place on validation
failure.

## No default close button

Unlike modals and drawers, popovers don't render a "×" by default —
they already dismiss on click-outside / ESC / opening another
popover, and a button is mostly visual noise in a small floating
panel. Opt back in per-view with `<% overlay_close true %>`, or
globally by editing `app/views/turbo_overlay/_popover.html.erb`.

## Drawer per-link options

For symmetry with popovers, `drawer_link_to` accepts two per-link
kwargs that override the configured defaults:

```erb
<%# Override the configured drawer side just for this link %>
<%= drawer_link_to "Filters", filters_path, position: :left %>

<%# Open without a backdrop — page stays scrollable and selectable.
    ESC still closes; click-outside is ignored (no backdrop). %>
<%= drawer_link_to "Inspector", inspect_path, backdrop: false %>
```

`backdrop: false` opens the drawer non-modally (`dialog.show()`
instead of `showModal()`). The browser doesn't render a `::backdrop`,
the page beneath stays fully interactive, and the page-wide scroll
lock is disabled. Useful when the user needs to read or copy from
the host page while the drawer is open.

### Backdrop knobs side-by-side

| Setting                                             | Backdrop visible? | Click outside dismisses? | Page interactive? |
|-----------------------------------------------------|:-----------------:|:------------------------:|:-----------------:|
| (default)                                           | ✓                 | ✓                        | —                 |
| `data-turbo-overlay-backdrop-dismiss-value="false"` | ✓                 | —                        | —                 |
| `drawer_link_to ..., backdrop: false`               | —                 | — (no backdrop to click) | ✓                 |
