class ApplicationController < ActionController::Base
  include TurboOverlay::Controller

  layout :resolve_layout

  private

  def resolve_layout
    return modal_layout_name   if modal_request?
    return drawer_layout_name  if drawer_request?
    return popover_layout_name if popover_request?
    "application"
  end
end
