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
    # stack tag / Stimulus registrations are detected and skipped.
    # Pass `--force` to overwrite existing files when upgrading.
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
        desc: "Skip injecting <%= overlay_stack_tag %> into application.html.erb"

      def validate_selection
        if options[:skip_modal] && options[:skip_drawer]
          raise Thor::Error, "Nothing to install — both --skip-modal and --skip-drawer were given."
        end

        @theme = options[:theme] || ask_theme

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

      def copy_modal_layout
        return unless @install_modal

        copy_file "layouts/#{@theme}.html.erb",
          "app/views/layouts/turbo_modal.html.erb"
      end

      def copy_drawer_layout
        return unless @install_drawer

        copy_file "drawer_layouts/#{@theme}.html.erb",
          "app/views/layouts/turbo_drawer.html.erb"
      end

      # The stack controller is theme-agnostic; the per-overlay
      # controller is theme-specific. Both install into the host
      # app's Stimulus controllers directory under the conventional
      # filenames so eager-loading picks them up automatically.
      def copy_javascript_controllers
        return if options[:skip_javascript]
        return unless stimulus_controllers_dir

        copy_file "javascript/stack_controller.js",
          "#{stimulus_controllers_dir}/turbo_overlay_stack_controller.js"

        copy_file "javascript/#{@theme}_overlay_controller.js",
          "#{stimulus_controllers_dir}/turbo_overlay_controller.js"
      end

      # If `controllers/index.js` uses Stimulus' eager-load convention,
      # nothing to do. Otherwise, append the import + register lines.
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
        unless contents.include?("turbo_overlay_stack_controller")
          lines << %(import TurboOverlayStackController from "./turbo_overlay_stack_controller")
          lines << %(application.register("turbo-overlay-stack", TurboOverlayStackController))
        end
        unless contents.include?("turbo_overlay_controller")
          lines << %(import TurboOverlayController from "./turbo_overlay_controller")
          lines << %(application.register("turbo-overlay", TurboOverlayController))
        end

        if lines.any?
          append_to_file index_path, "\n" + lines.join("\n") + "\n"
        else
          say_status :identical, index_path, :blue
        end
      end

      # Inject `<%= overlay_stack_tag %>` once. Older installs may
      # have `<%= overlay_frame_tags %>` — in that case we leave it
      # alone (the helper still works as a deprecated alias) and ask
      # the user to swap it during upgrade.
      def inject_overlay_stack_tag
        return if options[:skip_layout_inject]

        candidates = %w[
          app/views/layouts/application.html.erb
          app/views/layouts/application.html.haml
          app/views/layouts/application.html.slim
        ]
        layout_path = candidates.find { |p| File.exist?(File.join(destination_root, p)) }

        unless layout_path
          say_status :skip, "no application layout found; add `<%= overlay_stack_tag %>` manually", :yellow
          return
        end

        contents = File.read(File.join(destination_root, layout_path))
        if contents.include?("overlay_stack_tag") || contents.include?("overlay_frame_tags")
          say_status :identical, layout_path, :blue
          return
        end

        case File.extname(layout_path)
        when ".erb"
          inject_into_file layout_path, before: %r{</body>} do
            "    <%= overlay_stack_tag %>\n  "
          end
        when ".haml", ".slim"
          ext = File.extname(layout_path)[1..]
          say_status :skip, "#{layout_path} (#{ext} — add `= overlay_stack_tag` manually)", :yellow
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

          Overlays stack — opening one from inside another slides it on top
          rather than replacing. Close from server code with:

            turbo_stream.overlay(:close)              # close the top
            turbo_stream.overlay(:close, scope: :all) # close everything

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
