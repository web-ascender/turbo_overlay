module TurboOverlay
  module Helpers
    module ViewHelper
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

      # Whether the current view is being rendered inside a modal.
      def modal_request?
        return controller.modal_request? if controller.respond_to?(:modal_request?)
        _detect_overlay_type == :modal
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
      def drawer_link_to(name = nil, options = nil, html_options = nil, &block)
        _overlay_link_to(:drawer, name, options, html_options, &block)
      end

      # Inside a drawer, render a link styled as a "dismiss" trigger.
      def drawer_dismiss_link_to(name = nil, options = nil, html_options = nil, &block)
        _overlay_dismiss_link_to(:drawer, name, options, html_options, &block)
      end

      # Whether the current view is being rendered inside a drawer.
      def drawer_request?
        return controller.drawer_request? if controller.respond_to?(:drawer_request?)
        _detect_overlay_type == :drawer
      end

      # ----- Generic in-view helpers (shared between modal and drawer) -----

      # Emit the receiving stack container for overlays. Drop this in
      # your application layout (typically just before `</body>`)
      # once.
      #
      #   <%= overlay_stack_tag %>
      #
      # When the host app has an `app/views/turbo_overlay/_confirm.html.erb`
      # partial (copied by `turbo_overlay:install`), also emits a
      # sibling `<template id="turbo_overlay_confirm_template">`
      # containing the rendered partial. The JS confirm hook clones
      # this template on each `data-turbo-confirm` click; if it is
      # absent, the hook falls back to the browser-native `confirm()`.
      def overlay_stack_tag
        stack_id = TurboOverlay.configuration.stack_id
        stack = content_tag(:div, "".html_safe,
          id: stack_id,
          class: "turbo-overlay-stack",
          data: { controller: "turbo-overlay-stack" })

        return stack unless respond_to?(:lookup_context) && lookup_context
        return stack unless lookup_context.exists?("turbo_overlay/confirm", [], true)

        template = content_tag(:template,
          render(partial: "turbo_overlay/confirm"),
          id: "turbo_overlay_confirm_template")
        safe_join([stack, template])
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

      # The id of the overlay currently being rendered. Available
      # inside overlay layouts/partials and in any code path serving
      # an overlay request. Useful for `aria-labelledby` ids and for
      # `turbo_stream.overlay(:close, id: current_overlay_id)`.
      def current_overlay_id
        return controller.current_overlay_id if controller.respond_to?(:current_overlay_id)
        nil
      end

      # The per-link position override for the current overlay
      # request, or `nil` when the link didn't supply one. Drawer
      # partials read this with a fallback to
      # `TurboOverlay.configuration.drawer.position`.
      def current_overlay_position
        return controller.current_overlay_position if controller.respond_to?(:current_overlay_position)
        nil
      end

      # Whether the current overlay request should render with a
      # backdrop (the default) or non-modally (`backdrop: false` on
      # the link helper). Drawer partials switch the `<dialog>` open
      # mode and CSS based on this.
      def current_overlay_backdrop?
        return controller.current_overlay_backdrop? if controller.respond_to?(:current_overlay_backdrop?)
        true
      end

      # The DOM id of the per-overlay turbo-frame for the current
      # request: `turbo_overlay_<type>_<id>`. Used by overlay layouts
      # to tag the wrapping frame.
      def current_overlay_frame_id(type = nil)
        type ||= controller.respond_to?(:current_overlay_type) ? controller.current_overlay_type : nil
        return nil unless type && current_overlay_id
        "turbo_overlay_#{type}_#{current_overlay_id}"
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
        frame_id = "turbo_overlay_#{type}_#{current_overlay_id}"
        frame_html = turbo_frame_tag(frame_id, class: "turbo-overlay-frame", &block)

        is_re_render = controller.respond_to?(:turbo_overlay_frame_re_render?) &&
          controller.turbo_overlay_frame_re_render?

        if is_re_render
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

      private

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

        in_overlay = (type == :modal) ? modal_request? : drawer_request?
        if in_overlay
          stimulus_id = TurboOverlay.configuration.public_send(type).stimulus_identifier
          html_options["data-action"] ||= "click->#{stimulus_id}#close:prevent"
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
        has_backdrop = html_options.key?(:backdrop) || html_options.key?("backdrop")
        backdrop     = html_options.delete(:backdrop)
        backdrop     = html_options.delete("backdrop") if backdrop.nil? && has_backdrop

        data = (html_options[:data] || {}).dup
        data[:turbo_stream] = true unless data.key?(:turbo_stream) || html_options.key?("data-turbo-stream")
        data[:turbo_overlay] = type.to_s unless data.key?(:turbo_overlay) || html_options.key?("data-turbo-overlay")
        data[:turbo_overlay_id] = overlay_id.to_s if overlay_id && !data.key?(:turbo_overlay_id) && !html_options.key?("data-turbo-overlay-id")
        data[:turbo_overlay_position] = position.to_s if position && !data.key?(:turbo_overlay_position) && !html_options.key?("data-turbo-overlay-position")
        if has_backdrop && backdrop == false && !data.key?(:turbo_overlay_backdrop) && !html_options.key?("data-turbo-overlay-backdrop")
          data[:turbo_overlay_backdrop] = "false"
        end
        # Break out of any enclosing per-overlay turbo-frame so a click
        # on a modal/drawer link from inside an open overlay opens a
        # new (stacked) overlay instead of replacing the current one.
        data[:turbo_frame] = "_top" unless data.key?(:turbo_frame) || html_options.key?("data-turbo-frame")
        html_options[:data] = data unless data.empty?

        [options, html_options]
      end

      def _detect_overlay_type
        return nil unless respond_to?(:request) && request

        header = request.headers["X-Turbo-Overlay"].to_s.downcase
        return :modal  if header == "modal"
        return :drawer if header == "drawer"

        frame = request.headers["Turbo-Frame"].to_s
        if frame.start_with?("turbo_overlay_")
          rest = frame["turbo_overlay_".length..]
          return :modal  if rest.start_with?("modal_")
          return :drawer if rest.start_with?("drawer_")
        end

        nil
      end
    end
  end
end
