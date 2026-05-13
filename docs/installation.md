# Installation

## Generator

```bash
bin/rails generate turbo_overlay:install --theme tailwind
```

Themes: `plain` (default), `tailwind`, `bootstrap5`, `bootstrap3`.

What the generator does:

- **Chrome partials** copied to `app/views/turbo_overlay/`:
  `_modal.html.erb`, `_drawer.html.erb`, `_popover.html.erb`,
  `_hint.html.erb`, plus body-only `_confirm.html.erb` and
  `_loading.html.erb`. The body-only partials are wrapped in the
  matching chrome at template-emission time. Drop in a
  `_loading.html+<variant>.erb` or `_confirm.html+<variant>.erb`
  later if you need chrome-specific markup. These are *your* files —
  Tailwind / similar content scanners pick them up here automatically.
- **Initializer** at `config/initializers/turbo_overlay.rb`.
- **Stack tag** — `<%= overlay_stack_tag %>` injected before `</body>`
  in `app/views/layouts/application.html.erb`.
- **Importmap apps** — appends
  `import { register } from "turbo_overlay"; register(application, { confirm: true })`
  to your Stimulus entry (typically `app/javascript/controllers/index.js`).
  The `{ confirm: true }` flag routes `data-turbo-confirm` through the
  gem's themed dialog.
- **Propshaft apps** — injects `stylesheet_link_tag "turbo_overlay"`
  next to your existing one. (Propshaft doesn't rewrite CSS `@import`
  URLs to digested paths, so a separate link tag is the right primitive.)
- **Sprockets apps** — injects `*= require turbo_overlay` into your
  manifest CSS.
- **jsbundling / cssbundling apps** — prints the snippet to add to
  your bundler entry. See [bundling apps](#bundling-apps) below.

Re-running is idempotent — anything already in place is left alone.
Pass `--force` to overwrite existing chrome partials when switching
themes:

```bash
bin/rails g turbo_overlay:install --theme tailwind --force
```

Flags for skipping pieces (use when you want to wire one step
manually):

- `--skip-layout-inject` — don't inject `<%= overlay_stack_tag %>`
  into `application.html.erb`.
- `--skip-javascript` — don't append the Stimulus registration.
- `--skip-stylesheet` — don't wire the CSS link/import.
- `--skip-chrome` — don't copy chrome partials into
  `app/views/turbo_overlay/`.

If you skip the install generator entirely, the gem ships a plain
`<dialog>` chrome as a fallback — modals and drawers work, just
unstyled beyond the gem's CSS.

## ApplicationController

Include the concern:

```ruby
class ApplicationController < ActionController::Base
  include TurboOverlay::Controller
end
```

Including the concern auto-installs a `layout` proc that swaps in the
matching overlay layout for overlay requests. It also preserves
turbo-rails' `"turbo_rails/frame"` layout for plain turbo-frame
requests, so the concern does not regress Turbo's frame-layout
optimization.

The overlay layout **replaces** your application layout for overlay
requests — only the view content is wrapped in the dialog/drawer/popover
markup, not your nav, header, or footer. The host page already has
those; the appended overlay sits on top.

For apps with a custom layout method, call `turbo_overlay_layout`
from your method — see the "A note on custom layouts" section in the
README.

## Bundling apps

jsbundling-rails (esbuild/rollup/webpack/bun) and cssbundling-rails
apps have two paths:

1. **Reference the gem in place.** Add the gem's `app/javascript`
   and/or `app/assets/stylesheets` directories to your bundler's
   resolve paths, then:

    ```js
    import { register } from "turbo_overlay"
    register(application)
    ```

    ```css
    @import "turbo_overlay";
    ```

2. **Eject.** Copy the gem's JS or CSS into your app and import
   locally:

    ```bash
    bin/rails g turbo_overlay:eject --js
    bin/rails g turbo_overlay:eject --css
    bin/rails g turbo_overlay:eject --layouts
    ```

    (Chrome partials are not part of eject — they're already in your
    app after `turbo_overlay:install`.)

    Ejected files become yours; gem upgrades to those files no
    longer flow through.
