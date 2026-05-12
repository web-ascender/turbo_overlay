require "rails/generators/base"

module TurboOverlay
  module Generators
    # Wires the host app to use turbo_overlay. Detects the host's JS
    # and CSS toolchain, then either injects the required one-liners
    # or prints the snippets the user needs to paste. Also copies the
    # chosen chrome partials into `app/views/turbo_overlay/` so the
    # app owns its modal/drawer appearance from day one (and so
    # Tailwind / similar scanners can see the markup).
    #
    #   bin/rails g turbo_overlay:install
    #   bin/rails g turbo_overlay:install --theme tailwind
    #
    # Re-running is idempotent: existing files and already-injected
    # wiring are detected and skipped. Pass `--force` to overwrite
    # files when upgrading.
    class InstallGenerator < ::Rails::Generators::Base
      source_root File.expand_path("templates", __dir__)

      THEMES = %w[plain tailwind bootstrap5 bootstrap3].freeze

      class_option :theme,
        type: :string,
        default: "plain",
        desc: "Chrome theme to scaffold. One of: #{THEMES.join(", ")}."

      class_option :skip_layout_inject,
        type: :boolean,
        default: false,
        desc: "Skip injecting `<%= overlay_stack_tag %>` into application.html.erb"

      class_option :skip_javascript,
        type: :boolean,
        default: false,
        desc: "Skip wiring the Stimulus registration"

      class_option :skip_stylesheet,
        type: :boolean,
        default: false,
        desc: "Skip wiring the stylesheet import"

      class_option :skip_chrome,
        type: :boolean,
        default: false,
        desc: "Skip copying the modal/drawer chrome partials into app/views/turbo_overlay/"

      def validate_theme
        @theme = options[:theme].to_s
        unless THEMES.include?(@theme)
          raise Thor::Error,
            "Theme '#{@theme}' not recognized. Choose from: #{THEMES.join(", ")}."
        end
      end

      def copy_initializer
        template "initializer.rb.tt", "config/initializers/turbo_overlay.rb"
      end

      def copy_chrome_partials
        return if options[:skip_chrome]

        modal_src           = chrome_source_path("_modal.html.erb")
        drawer_src          = chrome_source_path("_drawer.html.erb")
        popover_src         = chrome_source_path("_popover.html.erb")
        confirm_modal_src   = chrome_source_path("_confirm.html+modal.erb")
        confirm_popover_src = chrome_source_path("_confirm.html+popover.erb")
        copy_file modal_src,           "app/views/turbo_overlay/_modal.html.erb"
        copy_file drawer_src,          "app/views/turbo_overlay/_drawer.html.erb"
        copy_file popover_src,         "app/views/turbo_overlay/_popover.html.erb"
        copy_file confirm_modal_src,   "app/views/turbo_overlay/_confirm.html+modal.erb"
        copy_file confirm_popover_src, "app/views/turbo_overlay/_confirm.html+popover.erb"
      end

      def inject_stack_tag
        return if options[:skip_layout_inject]

        layout_path = locate_application_layout
        unless layout_path
          say_status :skip, "no application.html.erb found; add `<%= overlay_stack_tag %>` before </body> manually", :yellow
          return
        end

        contents = File.read(File.join(destination_root, layout_path))
        if contents.include?("overlay_stack_tag") || contents.include?("overlay_frame_tags")
          say_status :identical, layout_path, :blue
          return
        end

        inject_into_file layout_path, before: %r{</body>} do
          "    <%= overlay_stack_tag %>\n  "
        end
      end

      def wire_javascript
        return if options[:skip_javascript]

        @js_setup = detect_js_setup
        case @js_setup
        when :importmap
          wire_importmap_stimulus_entry
        when :jsbundling
          @js_instructions_only = true
        else
          @js_instructions_only = true
        end
      end

      def wire_stylesheet
        return if options[:skip_stylesheet]

        @css_setup = detect_css_setup
        case @css_setup
        when :sprockets
          wire_sprockets_stylesheet
        when :propshaft
          wire_propshaft_stylesheet
        when :cssbundling
          @css_instructions_only = true
        else
          @css_instructions_only = true
        end
      end

      def show_post_install_message
        say <<~MSG, :green

          Turbo Overlay installed with the #{@theme} theme.

          Wire the controller concern in ApplicationController and swap to
          the matching layout per overlay request:

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

          Then open views as overlays:

            <%= modal_link_to   "New",     new_thing_path %>
            <%= drawer_link_to  "Filters", filters_path %>
            <%= popover_link_to "Edit",    edit_thing_path(@thing) %>

        MSG

        print_js_instructions_if_needed
        print_css_instructions_if_needed
      end

      private

      def chrome_source_path(filename)
        "chrome/#{@theme}/#{filename}"
      end

      def locate_application_layout
        %w[
          app/views/layouts/application.html.erb
          app/views/layouts/application.html.haml
          app/views/layouts/application.html.slim
        ].find { |p| File.exist?(File.join(destination_root, p)) }
      end

      def detect_js_setup
        return :importmap if File.exist?(File.join(destination_root, "config/importmap.rb"))

        pkg = File.join(destination_root, "package.json")
        if File.exist?(pkg)
          json = File.read(pkg)
          return :jsbundling if %w[esbuild rollup webpack bun].any? { |b| json.include?(%("#{b}")) }
        end

        :unknown
      end

      def detect_css_setup
        gemfile = File.join(destination_root, "Gemfile")
        if File.exist?(gemfile)
          content = File.read(gemfile)
          return :cssbundling if content.match?(/^\s*gem\s+["'](cssbundling-rails|dartsass-rails|tailwindcss-rails|sassc-rails)["']/)
          return :propshaft   if content.match?(/^\s*gem\s+["']propshaft["']/)
          return :sprockets   if content.match?(/^\s*gem\s+["']sprockets-rails["']/)
        end

        # Fall back to looking for a stylesheet file.
        return :sprockets if File.exist?(File.join(destination_root, "app/assets/stylesheets/application.css"))
        return :sprockets if File.exist?(File.join(destination_root, "app/assets/stylesheets/application.scss"))

        :unknown
      end

      def wire_importmap_stimulus_entry
        candidates = %w[
          app/javascript/controllers/index.js
          app/javascript/application.js
        ]
        path = candidates.find { |p| File.exist?(File.join(destination_root, p)) }
        unless path
          @js_instructions_only = true
          return
        end

        contents = File.read(File.join(destination_root, path))
        if contents.include?(%(from "turbo_overlay")) || contents.include?(%(from 'turbo_overlay'))
          say_status :identical, path, :blue
          return
        end

        append_to_file path, <<~JS

          import { register as registerTurboOverlay } from "turbo_overlay"
          registerTurboOverlay(application, { confirm: true })
        JS
      end

      def wire_sprockets_stylesheet
        candidates = %w[
          app/assets/stylesheets/application.css
          app/assets/stylesheets/application.css.scss
          app/assets/stylesheets/application.scss
        ]
        path = candidates.find { |p| File.exist?(File.join(destination_root, p)) }
        unless path
          @css_instructions_only = true
          return
        end

        contents = File.read(File.join(destination_root, path))
        if contents.include?("turbo_overlay")
          say_status :identical, path, :blue
          return
        end

        if path.end_with?(".css")
          # Manifest-style: inject `*= require turbo_overlay` into the
          # sprockets require block. Fall back to appending an import.
          if contents.include?("*= require_tree")
            inject_into_file path, before: " *= require_tree" do
              " *= require turbo_overlay\n"
            end
          elsif contents.match?(/\*=\s+require_self/)
            inject_into_file path, after: /\*=\s+require_self\n/ do
              " *= require turbo_overlay\n"
            end
          else
            append_to_file path, %(\n@import "turbo_overlay";\n)
          end
        else
          append_to_file path, %(\n@import "turbo_overlay";\n)
        end
      end

      def wire_propshaft_stylesheet
        # Propshaft doesn't rewrite `@import` URLs to digested paths,
        # so we can't inject `@import "turbo_overlay.css"` into the
        # app's manifest CSS — the browser would 404 on the
        # un-digested URL. Inject a `stylesheet_link_tag` into the
        # application layout instead so propshaft emits a separately
        # digested `<link>` for the gem's CSS.
        layout_path = locate_application_layout
        unless layout_path && layout_path.end_with?(".erb")
          @css_instructions_only = true
          return
        end

        contents = File.read(File.join(destination_root, layout_path))
        if contents.include?(%(stylesheet_link_tag "turbo_overlay")) ||
           contents.include?(%(stylesheet_link_tag 'turbo_overlay'))
          say_status :identical, layout_path, :blue
          return
        end

        # Insert after the first existing `stylesheet_link_tag` line we
        # find; otherwise fall back to printing instructions.
        first_link = contents.lines.find { |l| l.include?("stylesheet_link_tag") }
        unless first_link
          @css_instructions_only = true
          return
        end

        indent = first_link[/^\s*/]
        new_line = %(#{indent}<%= stylesheet_link_tag "turbo_overlay", "data-turbo-track": "reload" %>\n)

        # Thor's `after:` matches a String literally; pass the raw line.
        inject_into_file layout_path, after: first_link do
          new_line
        end
      end

      def print_js_instructions_if_needed
        return unless @js_instructions_only

        say <<~MSG, :yellow

          Couldn't auto-wire the JS. Add these lines to your Stimulus entry
          (typically app/javascript/controllers/index.js or your bundler's
          equivalent):

            import { register as registerTurboOverlay } from "turbo_overlay"
            registerTurboOverlay(application, { confirm: true })

          jsbundling-rails apps: add the gem's `app/javascript` directory
          to your bundler's resolve paths, OR run
          `bin/rails g turbo_overlay:eject --js` to copy the controllers
          into your app.

        MSG
      end

      def print_css_instructions_if_needed
        return unless @css_instructions_only

        say <<~MSG, :yellow

          Couldn't auto-wire the stylesheet. Pick the option that matches
          your setup:

            # propshaft — add to app/views/layouts/application.html.erb:
            <%= stylesheet_link_tag "turbo_overlay", "data-turbo-track": "reload" %>

            # sprockets manifest — add to app/assets/stylesheets/application.css:
            *= require turbo_overlay

            # cssbundling / dartsass / tailwind v4 — add to your source CSS:
            @import "turbo_overlay";

          Propshaft does not rewrite CSS `@import` URLs to digested
          asset paths; use a separate `stylesheet_link_tag` instead so
          the gem's CSS is served with a fingerprinted URL.

          cssbundling apps may also need to add the gem's
          `app/assets/stylesheets` directory to the bundler's load paths,
          OR run `bin/rails g turbo_overlay:eject --css` to copy the
          stylesheet into your app.

        MSG
      end
    end
  end
end
