require "test_helper"

class ConfigurationTest < Minitest::Test
  def setup
    TurboOverlay.reset_configuration!
  end

  def teardown
    TurboOverlay.reset_configuration!
  end

  # ---- stack ----

  def test_default_stack_id
    assert_equal "turbo_overlay_stack", TurboOverlay.configuration.stack_id
  end

  def test_configure_stack_id
    TurboOverlay.configure { |c| c.stack_id = "my_stack" }
    assert_equal "my_stack", TurboOverlay.configuration.stack_id
  end

  # ---- modal ----

  def test_default_modal_values
    modal = TurboOverlay.configuration.modal
    assert_equal :modal,        modal.variant
    assert_equal "turbo_modal", modal.layout_name
  end

  def test_configure_modal_with_block
    TurboOverlay.configure do |c|
      c.modal do |m|
        m.variant     = :custom_modal
        m.layout_name = "my_modal"
      end
    end

    assert_equal :custom_modal,  TurboOverlay.configuration.modal.variant
    assert_equal "my_modal",     TurboOverlay.configuration.modal.layout_name
  end

  def test_modal_returns_config_when_no_block
    assert_instance_of TurboOverlay::OverlayTypeConfig, TurboOverlay.configuration.modal
  end

  # ---- drawer ----

  def test_default_drawer_values
    drawer = TurboOverlay.configuration.drawer
    assert_equal :drawer,        drawer.variant
    assert_equal "turbo_drawer", drawer.layout_name
    assert_equal :right,         drawer.position
  end

  def test_configure_drawer_with_block
    TurboOverlay.configure do |c|
      c.drawer do |d|
        d.position = :left
      end
    end

    assert_equal :left, TurboOverlay.configuration.drawer.position
  end

  def test_drawer_returns_drawer_config_subclass
    assert_kind_of TurboOverlay::DrawerConfig,      TurboOverlay.configuration.drawer
    assert_kind_of TurboOverlay::OverlayTypeConfig, TurboOverlay.configuration.drawer
  end

  # ---- popover ----

  def test_default_popover_values
    popover = TurboOverlay.configuration.popover
    assert_equal :popover,        popover.variant
    assert_equal "turbo_popover", popover.layout_name
    assert_equal :bottom,         popover.position
    assert_equal :start,          popover.align
    assert_equal 4,               popover.offset
    assert_equal true,            popover.auto_flip
  end

  def test_configure_popover_with_block
    TurboOverlay.configure do |c|
      c.popover do |p|
        p.position  = :top
        p.align     = :center
        p.offset    = 8
        p.auto_flip = false
      end
    end

    popover = TurboOverlay.configuration.popover
    assert_equal :top,    popover.position
    assert_equal :center, popover.align
    assert_equal 8,       popover.offset
    assert_equal false,   popover.auto_flip
  end

  def test_popover_returns_popover_config_subclass
    assert_kind_of TurboOverlay::PopoverConfig,     TurboOverlay.configuration.popover
    assert_kind_of TurboOverlay::OverlayTypeConfig, TurboOverlay.configuration.popover
  end

  # ---- confirm ----

  def test_default_confirm_style_is_modal
    assert_equal :modal, TurboOverlay.configuration.confirm.style
  end

  def test_configure_confirm_with_block
    TurboOverlay.configure do |c|
      c.confirm { |cf| cf.style = :popover }
    end
    assert_equal :popover, TurboOverlay.configuration.confirm.style
  end

  def test_confirm_returns_confirm_config
    assert_kind_of TurboOverlay::ConfirmConfig, TurboOverlay.configuration.confirm
  end

  # ---- hint ----

  def test_default_hint_values
    hint = TurboOverlay.configuration.hint
    assert_equal :hint,        hint.variant
    assert_equal "turbo_hint", hint.layout_name
    assert_equal 250,          hint.show_delay_ms
    assert_equal 120,          hint.hide_delay_ms
  end

  def test_configure_hint_with_block
    TurboOverlay.configure do |c|
      c.hint do |h|
        h.show_delay_ms = 400
        h.hide_delay_ms = 200
      end
    end
    hint = TurboOverlay.configuration.hint
    assert_equal 400, hint.show_delay_ms
    assert_equal 200, hint.hide_delay_ms
  end

  def test_hint_returns_hint_config_subclass
    assert_kind_of TurboOverlay::HintConfig,        TurboOverlay.configuration.hint
    assert_kind_of TurboOverlay::OverlayTypeConfig, TurboOverlay.configuration.hint
  end

  # ---- reset ----

  def test_reset_configuration_restores_defaults
    TurboOverlay.configure do |c|
      c.stack_id = "custom_stack"
      c.drawer  { |d| d.position = :top }
      c.popover { |p| p.position = :left; p.offset = 12 }
      c.confirm { |cf| cf.style = :popover }
      c.hint    { |h| h.show_delay_ms = 500 }
    end
    assert_equal "custom_stack", TurboOverlay.configuration.stack_id
    assert_equal :top,           TurboOverlay.configuration.drawer.position
    assert_equal :left,          TurboOverlay.configuration.popover.position
    assert_equal 12,             TurboOverlay.configuration.popover.offset
    assert_equal :popover,       TurboOverlay.configuration.confirm.style
    assert_equal 500,            TurboOverlay.configuration.hint.show_delay_ms

    TurboOverlay.reset_configuration!
    assert_equal "turbo_overlay_stack", TurboOverlay.configuration.stack_id
    assert_equal :right,                TurboOverlay.configuration.drawer.position
    assert_equal :bottom,               TurboOverlay.configuration.popover.position
    assert_equal 4,                     TurboOverlay.configuration.popover.offset
    assert_equal :modal,                TurboOverlay.configuration.confirm.style
    assert_equal 250,                   TurboOverlay.configuration.hint.show_delay_ms
  end
end
