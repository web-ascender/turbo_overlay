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
    assert_equal :modal,           modal.variant
    assert_equal "turbo_modal",    modal.layout_name
    assert_equal "turbo-overlay",  modal.stimulus_identifier
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
    assert_equal :drawer,           drawer.variant
    assert_equal "turbo_drawer",    drawer.layout_name
    assert_equal "turbo-overlay",   drawer.stimulus_identifier
    assert_equal :right,            drawer.position
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

  # ---- reset ----

  def test_reset_configuration_restores_defaults
    TurboOverlay.configure do |c|
      c.stack_id = "custom_stack"
      c.drawer { |d| d.position = :top }
    end
    assert_equal "custom_stack", TurboOverlay.configuration.stack_id
    assert_equal :top,           TurboOverlay.configuration.drawer.position

    TurboOverlay.reset_configuration!
    assert_equal "turbo_overlay_stack", TurboOverlay.configuration.stack_id
    assert_equal :right,                TurboOverlay.configuration.drawer.position
  end
end
