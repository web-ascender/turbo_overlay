module TurboOverlay
  module Helpers
    module ViewHelper
      # The per-request predicates and accessors (`modal_request?`,
      # `drawer_request?`, `popover_request?`, `hint_request?`,
      # `turbo_overlay_id`, `turbo_overlay_type`,
      # `turbo_overlay_position`, `turbo_overlay_align`,
      # `turbo_overlay_offset`, `turbo_overlay_backdrop?`,
      # `turbo_overlay_close?`) live on `TurboOverlay::Controller` and
      # are exposed to views via `helper_method`. This module only
      # defines helpers that build markup or wrap content_for. The
      # install generator wires the concern into ApplicationController.

      # ----- Modal-specific link helpers -----

      # Build a link that opens its target as a modal overlay. The
      # response is appended to the host-page stack container, so a
      # modal opened from inside another modal stacks on top rather
      # than replacing.
      #
      #   <%= modal_link_to "New User", new_user_path %>
      #   <%= modal_link_to "Edit",     edit_user_path(@user),
      #                     overlay_id: "edit_user_#{@user.id}" %>
      #
      # `overlay_id:` is optional. When omitted the server generates a
      # random id; supply your own when you want to close the overlay
      # later from server code via
      # `turbo_stream.overlay(:close, id: "...")`.
      #
      # `close: false` opens the modal without the default close ("×")
      # button rendered by the chrome partial. Useful when the body
      # provides its own dismiss controls (the confirm partial uses
      # this internally). ESC and backdrop click still close.
      def modal_link_to(name = nil, options = nil, html_options = nil, &block)
        _overlay_link_to(:modal, name, options, html_options, &block)
      end

      # Inside a modal, render a link styled as a "dismiss" trigger.
      # Outside a modal, behaves like a normal `link_to`.
      #
      #   <%= modal_dismiss_link_to "Cancel", cancel_path %>
      def modal_dismiss_link_to(name = nil, options = nil, html_options = nil, &block)
        _overlay_dismiss_link_to(:modal, name, options, html_options, &block)
      end

      # ----- Drawer-specific link helpers -----

      # Build a link that opens its target as a drawer overlay. Same
      # stacking and `overlay_id:` semantics as `modal_link_to`.
      #
      #   <%= drawer_link_to "Filters", filters_path %>
      #
      # `position:` overrides the configured drawer side for this one
      # link (`:left`, `:right`, `:top`, `:bottom`). When omitted the
      # drawer opens on the side set by
      # `TurboOverlay.configuration.drawer.position`.
      #
      #   <%= drawer_link_to "Nav", nav_path, position: :left %>
      #
      # `backdrop: false` opens the drawer non-modally: no dimmed
      # backdrop, the page stays scrollable, and text on the page
      # remains selectable so users can copy/paste between the page
      # and the drawer. Click outside the drawer is also ignored
      # (no backdrop to click). ESC still closes.
      #
      #   <%= drawer_link_to "Inspector", inspect_path, backdrop: false %>
      #
      # `close: false` opens the drawer without the default close
      # ("×") button. ESC still closes; the backdrop is unaffected.
      def drawer_link_to(name = nil, options = nil, html_options = nil, &block)
        _overlay_link_to(:drawer, name, options, html_options, &block)
      end

      # Inside a drawer, render a link styled as a "dismiss" trigger.
      def drawer_dismiss_link_to(name = nil, options = nil, html_options = nil, &block)
        _overlay_dismiss_link_to(:drawer, name, options, html_options, &block)
      end

      # ----- Popover-specific link helpers -----

      # Build a link that opens its target as a popover overlay
      # anchored to the clicked link. Same stacking and `overlay_id:`
      # semantics as `modal_link_to`.
      #
      #   <%= popover_link_to "Edit", edit_user_path(@user) %>
      #
      # `position:` overrides the configured side (`:top`, `:bottom`,
      # `:left`, `:right`). `align:` overrides the cross-axis
      # alignment (`:start`, `:center`, `:end`). `offset:` overrides
      # the pixel gap between trigger and popover.
      #
      #   <%= popover_link_to "Info", info_path,
      #                       position: :top, align: :center, offset: 8 %>
      #
      # Popovers are non-modal (no backdrop, page stays interactive)
      # and dismiss on outside click or ESC. Opening a second popover
      # automatically closes any other open popover; modals and
      # drawers still stack on top.
      def popover_link_to(name = nil, options = nil, html_options = nil, &block)
        _overlay_link_to(:popover, name, options, html_options, &block)
      end

      # Inside a popover, render a link styled as a "dismiss" trigger.
      def popover_dismiss_link_to(name = nil, options = nil, html_options = nil, &block)
        _overlay_dismiss_link_to(:popover, name, options, html_options, &block)
      end

      # ----- Hint-specific helpers -----

      # Decorate any `<a>` so the gem's JS shows a hover-hint preview.
      # `hint_link_to` is a thin wrapper around `link_to` that sets the
      # two data attributes the JS reads. Compose freely with overlay
      # helpers (`modal_link_to "Edit", path, hint: true, hint_url: …`)
      # or set the data attributes directly on any `link_to`.
      #
      #   <%= hint_link_to "User", user_path(@user) %>
      #   <%= hint_link_to "User", user_path(@user), hint_url: hint_user_path(@user) %>
      #
      # Without `hint_url:`, the gem extracts a `<template id="...">`
      # from the page's own response when Turbo prefetches it on hover.
      # With `hint_url:`, the gem fetches the alternate URL with the
      # `:hint` request variant on hover. Overlay links
      # (`modal_link_to` etc.) are excluded from Turbo's hover prefetch
      # — provide `hint_url:` for them.
      def hint_link_to(name = nil, options = nil, html_options = nil, &block)
        if block_given?
          html_options = options || {}
          options      = name
          options, html_options = _hint_normalize_link_args(options, html_options)
          link_to(options, html_options, &block)
        else
          html_options = (html_options || {}).dup
          options, html_options = _hint_normalize_link_args(options, html_options)
          link_to(name, options, html_options)
        end
      end

      # ----- Generic in-view helpers (shared across overlay types) -----

      # Emit the receiving stack container for overlays. Drop this in
      # your application layout (typically just before `</body>`)
      # once.
      #
      #   <%= overlay_stack_tag %>
      #
      # When the host app has confirm chrome partials in
      # `app/views/turbo_overlay/`, emits sibling `<template>` elements
      # per variant the JS confirm hook clones from:
      #
      #   <template id="turbo_overlay_confirm_modal_template">…</template>
      #   <template id="turbo_overlay_confirm_popover_template">…</template>
      #
      # Partial resolution per variant prefers `_confirm.html+<variant>.erb`,
      # then falls back to a shared `_confirm.html.erb`. The shared
      # partial — if it's the only one present — is rendered once for
      # both modal and popover styles so apps that don't want
      # chrome-specific variants can ship a single file.
      #
      # The same shape applies to the loading partials:
      #
      #   <template id="turbo_overlay_loading_modal_template">…</template>
      #   <template id="turbo_overlay_loading_drawer_template">…</template>
      #   <template id="turbo_overlay_loading_popover_template">…</template>
      #   <template id="turbo_overlay_loading_hint_template">…</template>
      #
      # rendered from `_loading.html+<type>.erb` with `_loading.html.erb`
      # as the shared fallback. Cloned by the JS at click time to give
      # users immediate feedback while the real response is in flight.
      #
      # The configured default confirm style is exposed as a data
      # attribute on the stack container so the JS can read it without
      # a separate config plumbing pass.
      def overlay_stack_tag
        stack_id      = TurboOverlay.configuration.stack_id
        confirm_style = TurboOverlay.configuration.confirm.style.to_s
        hint_cfg      = TurboOverlay.configuration.hint

        data_attrs = {
          controller: "turbo-overlay-stack",
          "turbo-overlay-confirm-style": confirm_style,
          "turbo-overlay-hint-show-delay": hint_cfg.show_delay_ms,
          "turbo-overlay-hint-hide-delay": hint_cfg.hide_delay_ms
        }

        stack = content_tag(:div, "".html_safe,
          id: stack_id,
          class: "turbo-overlay-stack",
          data: data_attrs)

        return stack unless respond_to?(:lookup_context) && lookup_context

        parts = [stack]

        [:modal, :popover].each do |variant|
          rendered = _render_overlay_chrome_partial(
            "turbo_overlay/confirm", variant,
            chrome: variant, locals: { close: false }
          )
          next unless rendered
          parts << content_tag(:template, rendered,
            id: "turbo_overlay_confirm_#{variant}_template")
        end

        [:modal, :drawer, :popover, :hint].each do |variant|
          rendered = _render_overlay_chrome_partial(
            "turbo_overlay/loading", variant,
            chrome: variant, locals: { loading: true, close: false }
          )
          next unless rendered
          parts << content_tag(:template, rendered,
            id: "turbo_overlay_loading_#{variant}_template")
        end

        # On a hintable request, render the action's `+hint.erb`
        # variant template if one exists. Gated on
        # `_overlay_hintable_request?` so a regular page render
        # doesn't pay the cost.
        body = _turbo_overlay_resolved_hint_body
        if body
          hint_body = if lookup_context.exists?("turbo_overlay/hint", [], true)
            # Render the partial as a layout so the user's body lands
            # at `<%= yield %>`. Same pattern used by the modal/drawer
            # /popover layouts.
            render(layout: "turbo_overlay/hint") { body }
          else
            # No chrome partial in the app yet; emit the body unwrapped
            # so the JS still has something to extract.
            body
          end
          parts << content_tag(:template, hint_body, id: "turbo-overlay-hint")
        end

        return stack if parts.size == 1
        safe_join(parts)
      end

      # Deprecated. Aliased to `overlay_stack_tag` for one minor cycle.
      # The previous frame-per-type model has been replaced by a
      # single shared stack container.
      def overlay_frame_tags(*_types)
        ActiveSupport::Deprecation.new("0.4", "turbo_overlay").warn(
          "overlay_frame_tags is deprecated; use overlay_stack_tag instead."
        )
        overlay_stack_tag
      end

      # The DOM id of the per-overlay turbo-frame for the current
      # request: `turbo_overlay_<type>_<id>`. Used by overlay layouts
      # to tag the wrapping frame.
      def turbo_overlay_frame_id(type = nil)
        type ||= controller.turbo_overlay_type
        return nil unless type && turbo_overlay_id
        "turbo_overlay_#{type}_#{turbo_overlay_id}"
      end

      # Wraps the given block in the appropriate response primitive
      # for the current overlay request:
      #
      # - Initial open (`X-Turbo-Overlay` header): emits a
      #   `<turbo-stream action="append" target="<stack_id>">` whose
      #   template contains a `<turbo-frame id="<frame_id>">` around
      #   the dialog.
      # - Form re-render inside an open overlay
      #   (`Turbo-Frame: turbo_overlay_<type>_<id>`): emits just the
      #   `<turbo-frame id="<frame_id>">` so Turbo can replace the
      #   frame's contents in place.
      #
      # Used by the modal/drawer layouts to keep them readable.
      def overlay_response_wrapper(type, &block)
        frame_id = "turbo_overlay_#{type}_#{turbo_overlay_id}"
        frame_html = turbo_frame_tag(frame_id, class: "turbo-overlay-frame", &block)

        if controller.turbo_overlay_frame_re_render?
          frame_html
        else
          stack_id = TurboOverlay.configuration.stack_id
          turbo_stream.append(stack_id) { frame_html }
        end
      end

      # Set the overlay header title.
      def overlay_title(value = nil, &block)
        content_for(:overlay_title, value, &block)
      end

      # Set the overlay footer content.
      def overlay_footer(value = nil, &block)
        content_for(:overlay_footer, value, &block)
      end

      # Toggle the chrome's default close ("×") button for the current
      # overlay render. Defaults to on; call with `false` from inside an
      # overlay view to suppress it:
      #
      #   <% overlay_close false %>
      #
      # Precedence (highest first): partial local `close:` on `render
      # "turbo_overlay/modal"`, this helper, the link option `close:
      # false` (carried as a request header and exposed via
      # `turbo_overlay_close?`), then the default `true`.
      def overlay_close(show = true)
        @_overlay_close = show
      end

      # Whether the chrome should render its default close button.
      # Resolves the precedence described on `overlay_close`.
      def overlay_close?
        return @_overlay_close != false if defined?(@_overlay_close)
        controller.turbo_overlay_close?
      end

      private

      # Resolve the hint body for `overlay_stack_tag`. On a hintable
      # request (Turbo prefetch or explicit `:hint` variant fetch),
      # render the action's `+hint` variant template if one exists.
      # Apps that want hint previews drop a `show.html+hint.erb` next
      # to `show.html.erb` and the gem auto-emits its content.
      def _turbo_overlay_resolved_hint_body
        return nil unless _overlay_hintable_request?
        return nil unless _turbo_overlay_action_hint_variant_exists?
        render(
          template: _turbo_overlay_action_template_path,
          variants: [:hint],
          layout: false
        )
      end

      def _turbo_overlay_action_template_path
        "#{controller.controller_path}/#{controller.action_name}"
      end

      # Returns true only when a `+hint` variant template exists on
      # disk — NOT when `exists?(variants: [:hint])` falls back to the
      # plain template. Rails' variant resolution treats no-variant as
      # an acceptable match for any variant query, which would make us
      # auto-render the entire page as the hint body whenever the
      # action has any view at all (e.g. show.html.erb without a
      # +hint sibling). We inspect the resolved templates' identifiers
      # and require an actual `+hint.` segment in the filename.
      def _turbo_overlay_action_hint_variant_exists?
        path = _turbo_overlay_action_template_path
        return false unless path
        templates = lookup_context.find_all(path, [], false, [], variants: [:hint])
        templates.any? { |t| t.respond_to?(:identifier) && t.identifier.to_s.include?("+hint.") }
      end

      # Whether the hint template should be rendered for this request.
      # True for prefetches and explicit `:hint` variant fetches. The
      # detection lives on the controller concern; the view helper just
      # delegates so chrome-rendering code paths can read it.
      def _overlay_hintable_request?
        controller.overlay_hintable_request?
      end

      # Render `turbo_overlay/<name>` for the given variant, preferring
      # `_<name>.html+<variant>.erb` and falling back to a shared
      # `_<name>.html.erb` when no variant-specific override exists.
      # Returns nil when neither file is present so callers can skip
      # emitting an empty `<template>` wrapper.
      #
      # When `chrome:` is supplied, the rendered body is wrapped in the
      # `turbo_overlay/<chrome>` chrome partial (modal/drawer/popover/hint)
      # so confirm and loading body partials don't have to repeat
      # `<%= render "turbo_overlay/modal" do %>...<% end %>` boilerplate.
      # `locals:` flows to both the body and the chrome.
      def _render_overlay_chrome_partial(name, variant, chrome: nil, locals: {})
        unless lookup_context.exists?(name, [], true, [], variants: [variant]) ||
               lookup_context.exists?(name, [], true)
          return nil
        end

        if chrome
          render(partial: name, layout: "turbo_overlay/#{chrome}",
            variants: [variant], locals: locals)
        else
          render(partial: name, variants: [variant], locals: locals)
        end
      end

      def _overlay_link_to(type, name, options, html_options, &block)
        if block_given?
          html_options = options || {}
          options      = name
          options, html_options = _overlay_normalize_link_args(type, options, html_options)
          link_to(options, html_options, &block)
        else
          html_options = (html_options || {}).dup
          options, html_options = _overlay_normalize_link_args(type, options, html_options)
          link_to(name, options, html_options)
        end
      end

      def _overlay_dismiss_link_to(type, name, options, html_options, &block)
        html_options = (html_options || {}).dup

        in_overlay = case type
                     when :modal   then modal_request?
                     when :drawer  then drawer_request?
                     when :popover then popover_request?
                     end
        if in_overlay
          html_options["data-action"] ||= "click->turbo-overlay#close:prevent"
          html_options["data-turbo-#{type}-dismiss"] = "true"
        end

        if block_given?
          link_to(options || "#", html_options, &block)
        else
          link_to(name, options, html_options)
        end
      end

      def _overlay_normalize_link_args(type, options, html_options)
        html_options = (html_options || {}).dup
        overlay_id   = html_options.delete(:overlay_id) || html_options.delete("overlay_id")
        position     = html_options.delete(:position)   || html_options.delete("position")
        align        = html_options.delete(:align)      || html_options.delete("align")
        offset       = html_options.delete(:offset)     || html_options.delete("offset")
        has_backdrop = html_options.key?(:backdrop) || html_options.key?("backdrop")
        backdrop     = html_options.delete(:backdrop)
        backdrop     = html_options.delete("backdrop") if backdrop.nil? && has_backdrop
        has_close    = html_options.key?(:close) || html_options.key?("close")
        close_value  = html_options.delete(:close)
        close_value  = html_options.delete("close") if close_value.nil? && has_close
        has_hint     = html_options.key?(:hint) || html_options.key?("hint")
        hint_value   = html_options.delete(:hint)
        hint_value   = html_options.delete("hint") if hint_value.nil? && has_hint
        hint_url     = html_options.delete(:hint_url) || html_options.delete("hint_url")

        data = (html_options[:data] || {}).dup
        data[:turbo_stream] = true unless data.key?(:turbo_stream) || html_options.key?("data-turbo-stream")
        data[:turbo_overlay] = type.to_s unless data.key?(:turbo_overlay) || html_options.key?("data-turbo-overlay")
        data[:turbo_overlay_id] = overlay_id.to_s if overlay_id && !data.key?(:turbo_overlay_id) && !html_options.key?("data-turbo-overlay-id")
        data[:turbo_overlay_position] = position.to_s if position && !data.key?(:turbo_overlay_position) && !html_options.key?("data-turbo-overlay-position")
        data[:turbo_overlay_align] = align.to_s if align && !data.key?(:turbo_overlay_align) && !html_options.key?("data-turbo-overlay-align")
        data[:turbo_overlay_offset] = offset.to_s if offset && !data.key?(:turbo_overlay_offset) && !html_options.key?("data-turbo-overlay-offset")
        if has_backdrop && backdrop == false && !data.key?(:turbo_overlay_backdrop) && !html_options.key?("data-turbo-overlay-backdrop")
          data[:turbo_overlay_backdrop] = "false"
        end
        if has_close && close_value == false && !data.key?(:turbo_overlay_close) && !html_options.key?("data-turbo-overlay-close")
          data[:turbo_overlay_close] = "false"
        end
        if has_hint && hint_value && !data.key?(:turbo_overlay_hint) && !html_options.key?("data-turbo-overlay-hint")
          data[:turbo_overlay_hint] = "true"
        end
        if hint_url && !data.key?(:turbo_overlay_hint_url) && !html_options.key?("data-turbo-overlay-hint-url")
          data[:turbo_overlay_hint_url] = hint_url.to_s
        end
        # Break out of any enclosing per-overlay turbo-frame so a click
        # on a modal/drawer/popover link from inside an open overlay
        # opens a new (stacked) overlay instead of replacing the current one.
        data[:turbo_frame] = "_top" unless data.key?(:turbo_frame) || html_options.key?("data-turbo-frame")
        html_options[:data] = data unless data.empty?

        [options, html_options]
      end

      # Decorate a plain link with the gem's hint data attributes. Unlike
      # `_overlay_normalize_link_args` this does NOT set data-turbo-stream
      # or data-turbo-frame=_top — hint_link_to behaves as a regular link
      # (Turbo prefetch can still apply); the hint is just hover preview.
      def _hint_normalize_link_args(options, html_options)
        html_options = (html_options || {}).dup
        hint_url = html_options.delete(:hint_url) || html_options.delete("hint_url")

        data = (html_options[:data] || {}).dup
        data[:turbo_overlay_hint] = "true" unless data.key?(:turbo_overlay_hint) || html_options.key?("data-turbo-overlay-hint")
        if hint_url && !data.key?(:turbo_overlay_hint_url) && !html_options.key?("data-turbo-overlay-hint-url")
          data[:turbo_overlay_hint_url] = hint_url.to_s
        end
        html_options[:data] = data unless data.empty?

        [options, html_options]
      end

    end
  end
end
