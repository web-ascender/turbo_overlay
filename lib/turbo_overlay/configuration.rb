module TurboOverlay
  # Per-overlay-type config. Each type has its own variant, layout,
  # and Stimulus identifier so they can coexist on the same page.
  #
  # As of v0.3.0 overlays are appended to a shared stack container
  # (see `Configuration#stack_id`) rather than being routed to a
  # type-specific turbo-frame. The legacy `frame_id` attribute is
  # retained for backward compatibility — it's only consulted by the
  # deprecated `overlay_frame_tags` helper.
  class OverlayTypeConfig
    attr_accessor :frame_id, :variant, :layout_name, :stimulus_identifier

    def initialize(variant:, layout_name:, stimulus_identifier:, frame_id: nil)
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
    # DOM id of the host-page stack container that receives appended
    # overlays. Emit it in your application layout via
    # `<%= overlay_stack_tag %>`.
    attr_accessor :stack_id

    def initialize
      @stack_id = "turbo_overlay_stack"

      @modal = OverlayTypeConfig.new(
        frame_id:            "turbo_modal",
        variant:             :modal,
        layout_name:         "turbo_modal",
        stimulus_identifier: "turbo-overlay"
      )

      @drawer = DrawerConfig.new(
        frame_id:            "turbo_drawer",
        variant:             :drawer,
        layout_name:         "turbo_drawer",
        stimulus_identifier: "turbo-overlay",
        position:            :right
      )
    end

    # Modal config. With a block, yields the type config for setters;
    # without a block, returns it for direct access.
    #
    #   TurboOverlay.configure do |c|
    #     c.modal do |m|
    #       m.layout_name = "my_modal"
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
