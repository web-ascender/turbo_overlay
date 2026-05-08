module TurboOverlay
  module Helpers
    module ViewHelper
      # ----- Modal-specific link helpers -----

      # Build a link that opens its target inside the modal frame.
      # Sets `data-turbo-frame` to the configured modal frame id
      # (unless the caller already provided one).
      #
      #   <%= modal_link_to "New User", new_user_path %>
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
        request&.headers&.[]("Turbo-Frame") == TurboOverlay.configuration.modal.frame_id
      end

      # ----- Drawer-specific link helpers -----

      # Build a link that opens its target inside the drawer frame.
      #
      #   <%= drawer_link_to "Filters", filters_path %>
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
        request&.headers&.[]("Turbo-Frame") == TurboOverlay.configuration.drawer.frame_id
      end

      # ----- Generic in-view helpers (shared between modal and drawer) -----

      # Emit the receiving turbo-frames for one or more overlay types.
      # Drop this in your application layout (typically just before
      # `</body>`) once; it stays correct as you add overlay types.
      #
      #   <%= overlay_frame_tags %>             # all configured (modal + drawer)
      #   <%= overlay_frame_tags :modal %>      # only modal
      #   <%= overlay_frame_tags :modal, :drawer %>
      def overlay_frame_tags(*types)
        types = [:modal, :drawer] if types.empty?
        tags = types.map do |t|
          frame_id = TurboOverlay.configuration.public_send(t).frame_id
          turbo_frame_tag(frame_id)
        end
        safe_join(tags)
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
        unless html_options.key?(:data) && html_options[:data].is_a?(Hash) && html_options[:data].key?(:turbo_frame)
          unless html_options.key?("data-turbo-frame")
            frame_id = TurboOverlay.configuration.public_send(type).frame_id
            html_options[:data] = (html_options[:data] || {}).merge(turbo_frame: frame_id)
          end
        end
        [options, html_options]
      end
    end
  end
end
