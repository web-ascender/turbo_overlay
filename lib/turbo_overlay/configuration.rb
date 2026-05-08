module TurboOverlay
  # Per-overlay-type config (modal today, drawer in v0.2). Each type
  # has its own frame, variant, layout, and Stimulus identifier so
  # they can coexist on the same page.
  class OverlayTypeConfig
    attr_accessor :frame_id, :variant, :layout_name, :stimulus_identifier

    def initialize(frame_id:, variant:, layout_name:, stimulus_identifier:)
      @frame_id            = frame_id
      @variant             = variant
      @layout_name         = layout_name
      @stimulus_identifier = stimulus_identifier
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
    end

    # Modal config. With a block, yields the type config for setters;
    # without a block, returns it for direct access.
    #
    #   TurboOverlay.configure do |c|
    #     c.modal do |m|
    #       m.frame_id = "my_modal"
    #     end
    #   end
    #
    #   TurboOverlay.configuration.modal.frame_id
    def modal
      yield @modal if block_given?
      @modal
    end

    # v0.2 will add `drawer` here following the same pattern.
  end
end
