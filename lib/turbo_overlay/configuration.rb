module TurboOverlay
  # Per-overlay-type config. Each type has its own frame, variant,
  # layout, and Stimulus identifier so they can coexist on the same
  # page.
  class OverlayTypeConfig
    attr_accessor :frame_id, :variant, :layout_name, :stimulus_identifier

    def initialize(frame_id:, variant:, layout_name:, stimulus_identifier:)
      @frame_id            = frame_id
      @variant             = variant
      @layout_name         = layout_name
      @stimulus_identifier = stimulus_identifier
    end
  end

  # Drawer config extends OverlayTypeConfig with a default position
  # (`:left`, `:right`, `:top`, `:bottom`) used by shipped layouts.
  # Per-instance position can be overridden by editing the layout.
  class DrawerConfig < OverlayTypeConfig
    attr_accessor :position

    def initialize(position:, **kwargs)
      super(**kwargs)
      @position = position
    end
  end

  class Configuration
    def initialize
      @modal = OverlayTypeConfig.new(
        frame_id:            "turbo_modal",
        variant:             :modal,
        layout_name:         "turbo_modal",
        stimulus_identifier: "turbo-modal"
      )

      @drawer = DrawerConfig.new(
        frame_id:            "turbo_drawer",
        variant:             :drawer,
        layout_name:         "turbo_drawer",
        stimulus_identifier: "turbo-drawer",
        position:            :right
      )
    end

    # Modal config. With a block, yields the type config for setters;
    # without a block, returns it for direct access.
    #
    #   TurboOverlay.configure do |c|
    #     c.modal do |m|
    #       m.frame_id = "my_modal"
    #     end
    #   end
    def modal
      yield @modal if block_given?
      @modal
    end

    # Drawer config. Same shape as modal, plus a `position` attribute
    # (`:left`, `:right`, `:top`, `:bottom`).
    #
    #   TurboOverlay.configure do |c|
    #     c.drawer do |d|
    #       d.position = :left
    #     end
    #   end
    def drawer
      yield @drawer if block_given?
      @drawer
    end
  end
end
