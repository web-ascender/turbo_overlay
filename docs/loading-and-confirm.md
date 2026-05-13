# Loading state & themed confirm

## Loading placeholders

Every `modal_link_to` / `drawer_link_to` / `popover_link_to` click
drops a loading placeholder into the stack immediately so the user
sees feedback even when the controller is slow. The placeholder
inherits the link's options (backdrop, drawer position, popover
position/align/offset, close-button suppression) so it reads
visually the same as the eventual chrome. When the response lands,
the placeholder swaps in place.

ESC or clicking the backdrop on a placeholder cancels the in-flight
fetch.

To customize the spinner, edit `app/views/turbo_overlay/_loading.html.erb`.
For chrome-specific markup, add `_loading.html+<variant>.erb` (modal,
drawer, popover, or hint) — the variant wins when present.

## Themed confirm dialogs

`data-turbo-confirm` on links and forms normally pops the
browser-native `confirm()`. Pass `{ confirm: true }` to `register`
and they go through the gem's themed overlay instead — same dialog,
same animations, same stacking, no server round-trip.

```js
import { register } from "turbo_overlay"
register(application, { confirm: true })
```

```erb
<%= button_to "Delete", user_path(@user),
              method: :delete,
              data: { turbo_confirm: "Really delete this user?" } %>
```

The install generator drops `_confirm.html.erb` into your app. It
renders inside modal chrome (default) or popover chrome
(`config.confirm.style = :popover`, or
`data-turbo-confirm-style="popover"` per-link).

Three data attributes drive the dialog — keep these on your custom
markup:

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

Popover-style confirm needs an anchor (the clicked element). For
programmatic submissions with no submitter, the gem falls back to
the modal style.
