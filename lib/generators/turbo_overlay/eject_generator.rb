require "rails/generators/base"

module TurboOverlay
  module Generators
    # Copies gem-owned plumbing into the host app for full control.
    # Once ejected, gem upgrades to that subset don't flow through.
    # (Chrome partials are copied by the install generator and live in
    # the app from day one, so they're not part of eject.)
    #
    #   bin/rails g turbo_overlay:eject --js
    #   bin/rails g turbo_overlay:eject --css
    #   bin/rails g turbo_overlay:eject --layouts
    class EjectGenerator < ::Rails::Generators::Base
      GEM_ROOT = File.expand_path("../../..", __dir__)

      class_option :js,
        type: :boolean,
        default: false,
        desc: "Copy the Stimulus controllers into app/javascript/turbo_overlay/"

      class_option :css,
        type: :boolean,
        default: false,
        desc: "Copy the stylesheet into app/assets/stylesheets/turbo_overlay.css"

      class_option :layouts,
        type: :boolean,
        default: false,
        desc: "Copy turbo_modal.html.erb and turbo_drawer.html.erb into app/views/layouts/"

      def print_help_if_no_flags
        return if any_flag_given?

        say <<~MSG

          Nothing to eject. Pass one or more flags:

            --js        Copy Stimulus controllers to app/javascript/turbo_overlay/
            --css       Copy the stylesheet to app/assets/stylesheets/turbo_overlay.css
            --layouts   Copy modal/drawer layouts to app/views/layouts/

          Ejected files become app-owned — gem upgrades to those files no
          longer apply. (Chrome partials are copied by `turbo_overlay:install`
          and already live in your app.)

        MSG
      end

      def eject_javascript
        return unless options[:js]

        copy_gem_file "app/javascript/turbo_overlay/index.js",
          "app/javascript/turbo_overlay/index.js"
        copy_gem_file "app/javascript/turbo_overlay/stack_controller.js",
          "app/javascript/turbo_overlay/stack_controller.js"
        copy_gem_file "app/javascript/turbo_overlay/overlay_controller.js",
          "app/javascript/turbo_overlay/overlay_controller.js"

        say <<~MSG, :yellow

          JS ejected. Update your Stimulus entry to import locally:

            import { register as registerTurboOverlay } from "./turbo_overlay/index"
            registerTurboOverlay(application, { confirm: true })

          And remove the gem's importmap pin if you had one.

        MSG
      end

      def eject_stylesheet
        return unless options[:css]

        copy_gem_file "app/assets/stylesheets/turbo_overlay.css",
          "app/assets/stylesheets/turbo_overlay.css"
      end

      def eject_layouts
        return unless options[:layouts]

        copy_gem_file "app/views/layouts/turbo_modal.html.erb",
          "app/views/layouts/turbo_modal.html.erb"
        copy_gem_file "app/views/layouts/turbo_drawer.html.erb",
          "app/views/layouts/turbo_drawer.html.erb"
      end

      private

      def any_flag_given?
        options[:js] || options[:css] || options[:layouts]
      end

      def copy_gem_file(source_relative, destination_relative)
        source = File.join(GEM_ROOT, source_relative)
        unless File.exist?(source)
          say_status :missing, source_relative, :red
          return
        end
        create_file destination_relative, File.read(source)
      end
    end
  end
end
