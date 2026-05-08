require "rails/generators/base"

module TurboOverlay
  module Generators
    # Single install generator for modal + drawer.
    #
    #   bin/rails g turbo_overlay:install --theme tailwind
    #   bin/rails g turbo_overlay:install --theme tailwind --skip-drawer
    #   bin/rails g turbo_overlay:install --theme bootstrap3   # modal only (BS3 has no drawer)
    #
    # Re-running is idempotent: existing files and already-injected
    # frame tags / Stimulus registrations are detected and skipped.
    class InstallGenerator < ::Rails::Generators::Base
      source_root File.expand_path("templates", __dir__)

      MODAL_THEMES  = %w[tailwind bootstrap5 bootstrap3 plain].freeze
      DRAWER_THEMES = %w[tailwind bootstrap5 plain].freeze

      class_option :theme,
        type: :string,
        default: nil,
        desc: "Theme to install. Modal: #{MODAL_THEMES.join(", ")}. Drawer: #{DRAWER_THEMES.join(", ")}."

      class_option :skip_modal,
        type: :boolean,
        default: false,
        desc: "Skip modal install"

      class_option :skip_drawer,
        type: :boolean,
        default: false,
        desc: "Skip drawer install"

      class_option :skip_javascript,
        type: :boolean,
        default: false,
        desc: "Skip copying Stimulus controllers"

      class_option :skip_layout_inject,
        type: :boolean,
        default: false,
        desc: "Skip injecting <%= overlay_frame_tags %> into application.html.erb"

      def validate_selection
        if options[:skip_modal] && options[:skip_drawer]
          raise Thor::Error, "Nothing to install — both --skip-modal and --skip-drawer were given."
        end

        @theme = options[:theme] || ask_theme

        # If the chosen theme has no drawer (e.g. bootstrap3), auto-skip
        # drawer with a friendly note rather than erroring.
        @install_modal  = !options[:skip_modal]
        @install_drawer = !options[:skip_drawer] && DRAWER_THEMES.include?(@theme)

        if !options[:skip_drawer] && !DRAWER_THEMES.include?(@theme)
          say_status :skip, "drawer not available for theme '#{@theme}' (no native drawer primitive)", :yellow
        end

        if @install_modal && !MODAL_THEMES.include?(@theme)
          raise Thor::Error, "Modal theme '#{@theme}' not recognized. Choose from: #{MODAL_THEMES.join(", ")}."
        end
      end

      def copy_initializer
        template "initializer.rb.tt", "config/initializers/turbo_overlay.rb"
      end

      def copy_modal_files
        return unless @install_modal

        copy_file "layouts/#{@theme}.html.erb",
          "app/views/layouts/turbo_modal.html.erb"

        unless options[:skip_javascript]
          if stimulus_controllers_dir
            copy_file "javascript/#{@theme}_controller.js",
              "#{stimulus_controllers_dir}/turbo_modal_controller.js"
          end
        end
      end

      def copy_drawer_files
        return unless @install_drawer

        copy_file "drawer_layouts/#{@theme}.html.erb",
          "app/views/layouts/turbo_drawer.html.erb"

        unless options[:skip_javascript]
          if stimulus_controllers_dir
            copy_file "drawer_javascript/#{@theme}_controller.js",
              "#{stimulus_controllers_dir}/turbo_drawer_controller.js"
          end
        end
      end

      # If `controllers/index.js` uses Stimulus' eager-load convention,
      # nothing to do (filenames map to identifiers automatically).
      # Otherwise, append the import + register lines for whichever
      # controllers we just installed.
      def register_stimulus_controllers
        return if options[:skip_javascript]

        index_path = "app/javascript/controllers/index.js"
        full_path  = File.join(destination_root, index_path)
        return unless File.exist?(full_path)

        contents = File.read(full_path)
        if contents.include?("eagerLoadControllersFrom") || contents.include?("eagerLoadControllers")
          say_status :identical, "#{index_path} (auto-loaded via stimulus-loading)", :blue
          return
        end

        lines = []
        if @install_modal && !contents.include?("turbo_modal_controller")
          identifier = TurboOverlay.configuration.modal.stimulus_identifier
          lines << %(import TurboModalController from "./turbo_modal_controller")
          lines << %(application.register("#{identifier}", TurboModalController))
        end
        if @install_drawer && !contents.include?("turbo_drawer_controller")
          identifier = TurboOverlay.configuration.drawer.stimulus_identifier
          lines << %(import TurboDrawerController from "./turbo_drawer_controller")
          lines << %(application.register("#{identifier}", TurboDrawerController))
        end

        if lines.any?
          append_to_file index_path, "\n" + lines.join("\n") + "\n"
        else
          say_status :identical, index_path, :blue
        end
      end

      # Inject `<%= overlay_frame_tags %>` once. The helper emits
      # frames for whichever overlay types are configured, so the
      # layout doesn't need editing when a future overlay type is
      # added.
      def inject_overlay_frame_tags
        return if options[:skip_layout_inject]

        candidates = %w[
          app/views/layouts/application.html.erb
          app/views/layouts/application.html.haml
          app/views/layouts/application.html.slim
        ]
        layout_path = candidates.find { |p| File.exist?(File.join(destination_root, p)) }

        unless layout_path
          say_status :skip, "no application layout found; add `<%= overlay_frame_tags %>` manually", :yellow
          return
        end

        contents = File.read(File.join(destination_root, layout_path))
        modal_id  = TurboOverlay.configuration.modal.frame_id
        drawer_id = TurboOverlay.configuration.drawer.frame_id
        if contents.include?("overlay_frame_tags") ||
           contents.include?(%(turbo_frame_tag "#{modal_id}")) ||
           contents.include?(%(turbo_frame_tag "#{drawer_id}")) ||
           contents.include?(%(turbo-frame id="#{modal_id}")) ||
           contents.include?(%(turbo-frame id="#{drawer_id}"))
          say_status :identical, layout_path, :blue
          return
        end

        case File.extname(layout_path)
        when ".erb"
          inject_into_file layout_path, before: %r{</body>} do
            "    <%= overlay_frame_tags %>\n  "
          end
        when ".haml", ".slim"
          ext = File.extname(layout_path)[1..]
          say_status :skip, "#{layout_path} (#{ext} — add `= overlay_frame_tags` manually)", :yellow
        end
      end

      def show_post_install_message
        installed = []
        installed << "modal"  if @install_modal
        installed << "drawer" if @install_drawer

        layout_resolver =
          if @install_modal && @install_drawer
            <<~RUBY.indent(6)
              def resolve_layout
                return modal_layout_name  if modal_request?
                return drawer_layout_name if drawer_request?
                "application"
              end
            RUBY
          elsif @install_modal
            <<~RUBY.indent(6)
              def resolve_layout
                modal_request? ? modal_layout_name : "application"
              end
            RUBY
          else
            <<~RUBY.indent(6)
              def resolve_layout
                drawer_request? ? drawer_layout_name : "application"
              end
            RUBY
          end

        link_examples = []
        link_examples << '<%= modal_link_to  "New",     new_thing_path %>'  if @install_modal
        link_examples << '<%= drawer_link_to "Filters", filters_path %>'    if @install_drawer

        say <<~MSG, :green

          Turbo Overlay installed (#{installed.join(" + ")}) with the #{@theme} theme.

          One thing left to wire up — include the controller concern in
          ApplicationController and swap to the matching layout per
          request:

            class ApplicationController < ActionController::Base
              include TurboOverlay::Controller
              layout :resolve_layout

              private

          #{layout_resolver.chomp}
            end

          Then open links:

          #{link_examples.map { |l| "    #{l}" }.join("\n")}

        MSG
      end

      private

      def ask_theme
        say "Available themes: #{MODAL_THEMES.join(", ")} (drawer drops bootstrap3)"
        ask("Which theme would you like to install?", default: "tailwind", limited_to: MODAL_THEMES)
      end

      def stimulus_controllers_dir
        path = "app/javascript/controllers"
        return path if File.directory?(File.join(destination_root, path))
        say_status :skip, "#{path} not found; skipping JS controllers", :yellow
        nil
      end
    end
  end
end
