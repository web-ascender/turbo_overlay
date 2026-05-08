require "active_support/concern"

module TurboOverlay
  # Controller concern. Include in `ApplicationController` (or any
  # controller you want overlay-aware).
  #
  # Layout swapping uses standard Rails. Pick a layout method and
  # return the matching overlay layout for overlay requests:
  #
  #   class ApplicationController < ActionController::Base
  #     include TurboOverlay::Controller
  #     layout :resolve_layout
  #
  #     private
  #
  #     def resolve_layout
  #       return modal_layout_name  if modal_request?
  #       return drawer_layout_name if drawer_request?
  #       "application"
  #     end
  #   end
  #
  # The overlay layout *replaces* the application layout for overlay
  # requests — only the view content gets wrapped in the overlay
  # markup, not the host page's chrome.
  module Controller
    extend ActiveSupport::Concern

    included do
      prepend_before_action :_turbo_overlay_set_variant

      helper_method :modal_request?, :modal_frame_id, :modal_layout_name,
        :drawer_request?, :drawer_frame_id, :drawer_layout_name,
        :overlay_request?
    end

    # ----- modal -----

    def modal_request?
      _turbo_frame_request_matches?(modal_frame_id)
    end

    def modal_frame_id
      TurboOverlay.configuration.modal.frame_id
    end

    def modal_layout_name
      TurboOverlay.configuration.modal.layout_name
    end

    # ----- drawer -----

    def drawer_request?
      _turbo_frame_request_matches?(drawer_frame_id)
    end

    def drawer_frame_id
      TurboOverlay.configuration.drawer.frame_id
    end

    def drawer_layout_name
      TurboOverlay.configuration.drawer.layout_name
    end

    # ----- generic -----

    # True if the current request targets *any* configured overlay
    # frame (modal or drawer). Useful in shared partials.
    def overlay_request?
      modal_request? || drawer_request?
    end

    private

    def _turbo_frame_request_matches?(expected_id)
      return false unless respond_to?(:request) && request

      frame = request.headers["Turbo-Frame"]
      frame.present? && frame == expected_id
    end

    def _turbo_overlay_set_variant
      variant =
        if modal_request?
          TurboOverlay.configuration.modal.variant
        elsif drawer_request?
          TurboOverlay.configuration.drawer.variant
        end
      return unless variant

      if request.variant.is_a?(Array)
        request.variant << variant unless request.variant.include?(variant)
      else
        request.variant = variant
      end
    end
  end
end
