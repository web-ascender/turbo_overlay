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

    # Make the gem's `app/javascript` available to sprockets/propshaft
    # so importmap-rails can serve the controllers + entry point.
    initializer "turbo_overlay.assets" do |app|
      if app.config.respond_to?(:assets)
        app.config.assets.paths << root.join("app/javascript").to_s
      end
    end

    # Pin the gem's JS for importmap-rails apps. Apps then write:
    #
    #   import { register } from "turbo_overlay"
    #   register(application)
    #
    # in their Stimulus entry point. jsbundling apps either eject the
    # JS via `bin/rails g turbo_overlay:eject --js` or add the gem's
    # `app/javascript` dir to their bundler's resolve paths.
    #
    # Implementation: append the gem's `config/importmap.rb` to the
    # host app's importmap paths so importmap-rails draws the pins
    # during its own `importmap` initializer.
    initializer "turbo_overlay.importmap", before: "importmap" do |app|
      if app.config.respond_to?(:importmap) && app.config.importmap.respond_to?(:paths)
        app.config.importmap.paths << root.join("config/importmap.rb")
      end
    end
  end
end
