# Loading state & themed confirm

## Loading placeholders

Every `modal_link_to` / `drawer_link_to` / `popover_link_to` click
drops a loading placeholder into the stack immediately so the user
sees feedback even when the controller is slow. The placeholder
inherits the link's options — backdrop on/off, drawer position,
popover position/align/offset, close-button suppression — so it
reads visually the same as the eventual chrome.

When the server-rendered overlay arrives in its turbo-stream, Turbo's
`before-stream-render` removes the placeholder. The same cleanup
fires on fetch errors and on `turbo:visit`.

ESC or clicking the backdrop on a placeholder calls `abort()` on the
underlying `AbortController`, so the in-flight fetch is cancelled
instead of completing and popping the overlay back open.

### How it's wired

The placeholder is cloned from
`<template id="turbo_overlay_loading_<modal|drawer|popover|hint>_template">`
that `overlay_stack_tag` emits — one per chrome type, rendered from
the shared `_loading.html.erb` (body-only) wrapped in the matching
chrome partial with `loading: true`. The `loading:` flag tells the
chrome partial to:

- skip the Stimulus controller wiring (the placeholder is static, not
  a real overlay);
- skip the close button, overlay title, and overlay footer slots;
- swap `aria-labelledby` for
  `role="status" aria-live="polite" aria-label="Loading"`;
- add a `turbo-overlay--loading` modifier class for visual tweaks.
  (The shipped CSS adds a spinner with `prefers-reduced-motion`
  support, and collapses the body's default padding inside hint
  chrome so the spinner fits a tooltip-sized container.)

Apps that want a different spinner per chrome type drop in
`_loading.html+<variant>.erb` (modal/drawer/popover/hint) — same
body-only contract as the confirm partials. The variant wins when
present; otherwise the shared `_loading.html.erb` renders into every
chrome.

## Themed confirm dialogs

`data-turbo-confirm` on links and forms normally pops the
browser-native `confirm()`. Pass `{ confirm: true }` to `register`
and they go through the gem's themed overlay instead — same dialog,
same animations, same stacking. No server round-trip; the dialog
body is cloned from a `<template>` rendered into the page once by
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

The install generator drops `_confirm.html.erb` into your app — a
shared body wrapped at emission time in modal chrome (default) or
popover chrome (`config.confirm.style = :popover` or
`data-turbo-confirm-style="popover"`).

JS only depends on three data attributes:

| Attribute                                  | Role                                |
|--------------------------------------------|-------------------------------------|
| `[data-turbo-overlay-confirm-message]`     | element whose text becomes the message |
| `[data-turbo-overlay-confirm-cancel]`      | clicking resolves the promise as cancel |
| `[data-turbo-overlay-confirm-accept]`      | clicking resolves the promise as accept |

Add `_confirm.html+modal.erb` or `_confirm.html+popover.erb` for
chrome-specific tuning (variant wins over the shared file). Delete
the partial entirely and the hook falls back to the browser-native
`confirm()`.

### Modal or popover?

The default is `:modal`. Switch globally:

```ruby
TurboOverlay.configure do |config|
  config.confirm.style = :popover   # default :modal
end
```

Or per-link:

```erb
<%= button_to "Delete", user_path(@user),
              method: :delete,
              data: { turbo_confirm: "Really delete?",
                      turbo_confirm_style: "popover" } %>
```

Popover-style confirm needs an anchor — the element the user clicked
to trigger the form submission. If a programmatic submission triggers
a confirm with no submitter, the gem falls back to the modal style
silently rather than rendering a popover at the top-left corner.
