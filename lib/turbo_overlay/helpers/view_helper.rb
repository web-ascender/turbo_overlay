module TurboOverlay
  module Helpers
    module ViewHelper
      # ----- Modal-specific link helpers -----
      # v0.2 will add `drawer_link_to` / `drawer_dismiss_link_to`.

      # Build a link that opens its target inside the modal frame.
      # Sets `data-turbo-frame` to the configured modal frame id
      # (unless the caller already provided one).
      #
      #   <%= modal_link_to "New User", new_user_path %>
      def modal_link_to(name = nil, options = nil, html_options = nil, &block)
        if block_given?
          html_options = options || {}
          options      = name
          options, html_options = _modal_normalize_link_args(options, html_options)
          link_to(options, html_options, &block)
        else
          html_options = (html_options || {}).dup
          options, html_options = _modal_normalize_link_args(options, html_options)
          link_to(name, options, html_options)
        end
      end

      # Inside a modal, render a link styled as a "dismiss" trigger.
      # Outside a modal, behaves like a normal `link_to` so the same
      # view works on both paths.
      #
      #   <%= modal_dismiss_link_to "Cancel", cancel_path %>
      def modal_dismiss_link_to(name = nil, options = nil, html_options = nil, &block)
        html_options = (html_options || {}).dup

        if modal_request?
          stimulus_id = TurboOverlay.configuration.modal.stimulus_identifier
          html_options["data-action"] ||= "click->#{stimulus_id}#close:prevent"
          html_options["data-turbo-modal-dismiss"] = "true"
        end

        if block_given?
          link_to(options || "#", html_options, &block)
        else
          link_to(name, options, html_options)
        end
      end

      # Whether the current view is being rendered inside a modal.
      # Mirrors the controller helper for use in shared partials.
      def modal_request?
        return controller.modal_request? if controller.respond_to?(:modal_request?)
        request&.headers&.[]("Turbo-Frame") == TurboOverlay.configuration.modal.frame_id
      end

      # ----- Generic in-view helpers (shared with future drawer) -----
      #
      # These set content_for blocks the layout reads. The keys are
      # intentionally generic (`:overlay_title`, `:overlay_footer`) so
      # a view written for a modal renders correctly in a drawer too.

      # Set the overlay header title.
      #
      #   <% overlay_title "New User" %>
      #   <% overlay_title do %>
      #     <i class="far fa-user"></i> New User
      #   <% end %>
      def overlay_title(value = nil, &block)
        content_for(:overlay_title, value, &block)
      end

      # Set the overlay footer content.
      #
      #   <% overlay_footer do %>
      #     <%= modal_dismiss_link_to "Cancel", users_path, class: "btn" %>
      #     <button type="submit" class="btn btn-primary">Save</button>
      #   <% end %>
      def overlay_footer(value = nil, &block)
        content_for(:overlay_footer, value, &block)
      end

      private

      def _modal_normalize_link_args(options, html_options)
        html_options = (html_options || {}).dup
        unless html_options.key?(:data) && html_options[:data].is_a?(Hash) && html_options[:data].key?(:turbo_frame)
          unless html_options.key?("data-turbo-frame")
            frame_id = TurboOverlay.configuration.modal.frame_id
            html_options[:data] = (html_options[:data] || {}).merge(turbo_frame: frame_id)
          end
        end
        [options, html_options]
      end
    end
  end
end
