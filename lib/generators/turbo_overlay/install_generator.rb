require "rails/generators/base"

module TurboOverlay
  module Generators
    class InstallGenerator < ::Rails::Generators::Base
      source_root File.expand_path("templates", __dir__)

      THEMES = %w[tailwind bootstrap5 bootstrap3 plain].freeze

      class_option :theme,
        type: :string,
        default: nil,
        desc: "Theme to install: #{THEMES.join(", ")}"

      class_option :skip_javascript,
        type: :boolean,
        default: false,
        desc: "Skip copying the Stimulus controller"

      class_option :skip_layout_inject,
        type: :boolean,
        default: false,
        desc: "Skip auto-inserting <turbo-frame> into application.html.erb"

      def choose_theme
        @theme = options[:theme] || ask_theme
        unless THEMES.include?(@theme)
          raise Thor::Error, "Unknown theme: #{@theme}. Choose one of: #{THEMES.join(", ")}"
        end
      end

      def copy_initializer
        template "initializer.rb.tt", "config/initializers/turbo_overlay.rb"
      end

      def copy_layout
        copy_file "layouts/#{@theme}.html.erb", "app/views/layouts/turbo_modal.html.erb"
      end

      def copy_stimulus_controller
        return if options[:skip_javascript]

        controllers_path = "app/javascript/controllers"
        unless File.directory?(File.join(destination_root, controllers_path))
          say_status :skip, "#{controllers_path} not found; skipping JS controller", :yellow
          return
        end

        copy_file "javascript/#{@theme}_controller.js",
          "#{controllers_path}/turbo_modal_controller.js"
      end

      # If the host's controllers/index.js uses Stimulus' eager-load
      # convention, our `turbo_modal_controller.js` is auto-registered
      # as `turbo-modal` — nothing more to do. Otherwise, inject the
      # explicit import + register lines.
      def register_stimulus_controller
        return if options[:skip_javascript]

        index_path = "app/javascript/controllers/index.js"
        full_path  = File.join(destination_root, index_path)
        return unless File.exist?(full_path)

        contents = File.read(full_path)
        if contents.include?("eagerLoadControllersFrom") || contents.include?("eagerLoadControllers")
          say_status :identical, "#{index_path} (auto-loaded via stimulus-loading)", :blue
          return
        end

        if contents.include?("turbo_modal_controller")
          say_status :identical, index_path, :blue
          return
        end

        identifier = TurboOverlay.configuration.modal.stimulus_identifier
        append_to_file index_path do
          <<~JS

            import TurboModalController from "./turbo_modal_controller"
            application.register("#{identifier}", TurboModalController)
          JS
        end
      end

      # Inject the modal turbo-frame into application.html.erb just
      # before </body>. Skipped if already present.
      def inject_turbo_frame_into_layout
        return if options[:skip_layout_inject]

        candidates = %w[
          app/views/layouts/application.html.erb
          app/views/layouts/application.html.haml
          app/views/layouts/application.html.slim
        ]
        layout_path = candidates.find { |p| File.exist?(File.join(destination_root, p)) }

        unless layout_path
          say_status :skip, "no application layout found; add the frame manually", :yellow
          return
        end

        frame_id = TurboOverlay.configuration.modal.frame_id
        contents = File.read(File.join(destination_root, layout_path))
        if contents.include?(%(turbo_frame_tag "#{frame_id}")) ||
           contents.include?(%(turbo_frame_tag :"#{frame_id}")) ||
           contents.include?(%(turbo-frame id="#{frame_id}"))
          say_status :identical, layout_path, :blue
          return
        end

        case File.extname(layout_path)
        when ".erb"
          inject_into_file layout_path, before: %r{</body>} do
            %(    <%= turbo_frame_tag "#{frame_id}" %>\n  )
          end
        when ".haml"
          say_status :skip, "#{layout_path} (haml — add `= turbo_frame_tag \"#{frame_id}\"` manually)", :yellow
        when ".slim"
          say_status :skip, "#{layout_path} (slim — add `= turbo_frame_tag \"#{frame_id}\"` manually)", :yellow
        end
      end

      def show_post_install_message
        say <<~MSG, :green

          Turbo Overlay installed with the #{@theme} theme.

          One thing left to wire up — include the controller concern in
          ApplicationController and swap to the modal layout for modal
          requests:

            class ApplicationController < ActionController::Base
              include TurboOverlay::Controller
              layout :resolve_layout

              private

              def resolve_layout
                modal_request? ? modal_layout_name : "application"
              end
            end

          Then open links in the modal:

            <%= modal_link_to "New", new_thing_path %>

        MSG
      end

      private

      def ask_theme
        say "Available themes: #{THEMES.join(", ")}"
        ask("Which theme would you like to install?", default: "tailwind", limited_to: THEMES)
      end
    end
  end
end
