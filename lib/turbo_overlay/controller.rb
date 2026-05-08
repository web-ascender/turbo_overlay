require "active_support/concern"

module TurboOverlay
  # Controller concern. Include in `ApplicationController` (or any
  # controller you want modal-aware).
  #
  # Layout swapping uses standard Rails. Pick a layout method and
  # return the modal layout for modal requests:
  #
  #   class ApplicationController < ActionController::Base
  #     include TurboOverlay::Controller
  #     layout :resolve_layout
  #
  #     private
  #
  #     def resolve_layout
  #       modal_request? ? modal_layout_name : "application"
  #     end
  #   end
  #
  # The modal layout *replaces* the application layout for modal
  # requests — only the view content gets wrapped in the dialog
  # markup, not the host page's chrome (nav, header, footer). The
  # host page already has those.
  module Controller
    extend ActiveSupport::Concern

    included do
      prepend_before_action :_turbo_overlay_set_modal_variant

      helper_method :modal_request?, :modal_frame_id, :modal_layout_name
    end

    # Whether the current request was made by Turbo targeting the
    # modal frame. Available to controllers and views.
    def modal_request?
      return false unless respond_to?(:request) && request

      frame = request.headers["Turbo-Frame"]
      frame.present? && frame == modal_frame_id
    end

    # The modal frame id used by this request. Override in a subclass
    # if you need per-controller frame ids.
    def modal_frame_id
      TurboOverlay.configuration.modal.frame_id
    end

    # The configured modal layout name. Use it from a `layout :method`
    # so the controller doesn't have to hardcode the layout filename.
    def modal_layout_name
      TurboOverlay.configuration.modal.layout_name
    end

    private

    def _turbo_overlay_set_modal_variant
      return unless modal_request?

      variant = TurboOverlay.configuration.modal.variant
      if request.variant.is_a?(Array)
        request.variant << variant unless request.variant.include?(variant)
      else
        request.variant = variant
      end
    end
  end
end
