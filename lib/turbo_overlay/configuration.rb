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

  # Confirm prompt config. Controls how `data-turbo-confirm` is
  # rendered when the gem's themed confirm hook is registered via
  # `register(application, { confirm: true })`.
  #
  # - `style`: `:modal` (default) renders the prompt centered in the
  #   modal chrome. `:popover` renders it anchored to the submitter
  #   element (the clicked link or button), which is often friendlier
  #   for destructive actions next to a row or button. Per-link
  #   override via `data-turbo-confirm-style="popover"` (or `"modal"`)
  #   on the link/form.
  class ConfirmConfig
    attr_accessor :style

    def initialize(style:)
      @style = style
    end
  end

  # Hint config. Hover-triggered preview overlays. Hint attributes
  # (`data-turbo-overlay-hint`, `data-turbo-overlay-hint-url`) compose
  # with every overlay link helper and with plain `link_to`/`hint_link_to`.
  #
  # - `show_delay_ms`: hover must persist this long before the hint
  #   shows (default 250ms).
  # - `hide_delay_ms`: grace window after mouseleave before dismissing,
  #   so the user can move the cursor into the hint (default 120ms).
  # - `template_id`: id of the `<template>` element the gem emits
  #   inline AND that hint-variant responses wrap their body in,
  #   so the JS extractor has one code path (default
  #   `"turbo-overlay-hint"`).
  # - `enabled`: globally turn the hint feature off (default true).
  #   Inert without `data-turbo-overlay-hint` markers anyway, so the
  #   knob is mostly for opting an app out entirely.
  class HintConfig < OverlayTypeConfig
    attr_accessor :show_delay_ms, :hide_delay_ms, :template_id, :enabled

    def initialize(show_delay_ms:, hide_delay_ms:, template_id:, enabled:, **kwargs)
      super(**kwargs)
      @show_delay_ms = show_delay_ms
      @hide_delay_ms = hide_delay_ms
      @template_id   = template_id
      @enabled       = enabled
    end
  end

  # Popover config extends OverlayTypeConfig with anchored-positioning
  # defaults. Popovers attach to their trigger element rather than
  # centering (modal) or pinning to an edge (drawer).
  #
  # - `position`: side of the trigger to attach to (`:top`, `:bottom`,
  #   `:left`, `:right`). Default `:bottom`.
  # - `align`: cross-axis alignment relative to the trigger
  #   (`:start`, `:center`, `:end`). Default `:start`.
  # - `offset`: pixels between trigger edge and dialog edge. Default `4`.
  # - `auto_flip`: flip to the opposite side when the preferred
  #   placement would overflow the viewport. Default `true`.
  class PopoverConfig < OverlayTypeConfig
    attr_accessor :position, :align, :offset, :auto_flip

    def initialize(position:, align:, offset:, auto_flip:, **kwargs)
      super(**kwargs)
      @position  = position
      @align     = align
      @offset    = offset
      @auto_flip = auto_flip
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

      @popover = PopoverConfig.new(
        frame_id:            "turbo_popover",
        variant:             :popover,
        layout_name:         "turbo_popover",
        stimulus_identifier: "turbo-overlay",
        position:            :bottom,
        align:               :start,
        offset:              4,
        auto_flip:           true
      )

      @confirm = ConfirmConfig.new(style: :modal)

      @hint = HintConfig.new(
        frame_id:            nil,
        variant:             :hint,
        layout_name:         "turbo_hint",
        stimulus_identifier: "turbo-overlay-hint",
        show_delay_ms:       250,
        hide_delay_ms:       120,
        template_id:         "turbo-overlay-hint",
        enabled:             true
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

    # Popover config. Anchored to the trigger element. Same shape as
    # modal, plus `position`, `align`, `offset`, and `auto_flip`.
    #
    #   TurboOverlay.configure do |c|
    #     c.popover do |p|
    #       p.position = :top
    #       p.align    = :center
    #     end
    #   end
    def popover
      yield @popover if block_given?
      @popover
    end

    # Confirm-prompt config. Controls how `data-turbo-confirm` renders.
    #
    #   TurboOverlay.configure do |c|
    #     c.confirm do |cf|
    #       cf.style = :popover    # default :modal
    #     end
    #   end
    def confirm
      yield @confirm if block_given?
      @confirm
    end

    # Hint config. Hover-triggered preview overlays.
    #
    #   TurboOverlay.configure do |c|
    #     c.hint do |h|
    #       h.show_delay_ms = 400
    #       h.enabled       = false   # turn the feature off entirely
    #     end
    #   end
    def hint
      yield @hint if block_given?
      @hint
    end
  end
end
