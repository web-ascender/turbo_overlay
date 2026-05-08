require "rails/engine"
require "turbo-rails"

module TurboOverlay
  class Engine < ::Rails::Engine
    isolate_namespace TurboOverlay

    initializer "turbo_overlay.action_view" do
      ActiveSupport.on_load(:action_view) do
        require "turbo_overlay/helpers/view_helper"
        include TurboOverlay::Helpers::ViewHelper
      end
    end

    initializer "turbo_overlay.turbo_stream_actions" do
      require "turbo_overlay/helpers/stream_helper"
      Turbo::Streams::TagBuilder.include(TurboOverlay::Helpers::StreamHelper)
    end

    # Eager-load the controller concern so `include TurboOverlay::Controller`
    # works in user code without an explicit require.
    initializer "turbo_overlay.controller_autoload" do
      require "turbo_overlay/controller"
    end
  end
end
