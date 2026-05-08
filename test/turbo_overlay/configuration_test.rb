require "test_helper"

class ConfigurationTest < Minitest::Test
  def setup
    TurboOverlay.reset_configuration!
  end

  def teardown
    TurboOverlay.reset_configuration!
  end

  # ---- modal ----

  def test_default_modal_values
    modal = TurboOverlay.configuration.modal
    assert_equal "turbo_modal", modal.frame_id
    assert_equal :modal,        modal.variant
    assert_equal "turbo_modal", modal.layout_name
    assert_equal "turbo-modal", modal.stimulus_identifier
  end

  def test_configure_modal_with_block
    TurboOverlay.configure do |c|
      c.modal do |m|
        m.frame_id    = "my_modal"
        m.variant     = :custom_modal
        m.layout_name = "my_modal"
      end
    end

    assert_equal "my_modal",     TurboOverlay.configuration.modal.frame_id
    assert_equal :custom_modal,  TurboOverlay.configuration.modal.variant
    assert_equal "my_modal",     TurboOverlay.configuration.modal.layout_name
  end

  def test_modal_returns_config_when_no_block
    assert_instance_of TurboOverlay::OverlayTypeConfig, TurboOverlay.configuration.modal
  end

  # ---- drawer ----

  def test_default_drawer_values
    drawer = TurboOverlay.configuration.drawer
    assert_equal "turbo_drawer", drawer.frame_id
    assert_equal :drawer,        drawer.variant
    assert_equal "turbo_drawer", drawer.layout_name
    assert_equal "turbo-drawer", drawer.stimulus_identifier
    assert_equal :right,         drawer.position
  end

  def test_configure_drawer_with_block
    TurboOverlay.configure do |c|
      c.drawer do |d|
        d.position = :left
        d.frame_id = "my_drawer"
      end
    end

    assert_equal :left,        TurboOverlay.configuration.drawer.position
    assert_equal "my_drawer",  TurboOverlay.configuration.drawer.frame_id
  end

  def test_drawer_returns_drawer_config_subclass
    assert_kind_of TurboOverlay::DrawerConfig,      TurboOverlay.configuration.drawer
    assert_kind_of TurboOverlay::OverlayTypeConfig, TurboOverlay.configuration.drawer
  end

  # ---- reset ----

  def test_reset_configuration_restores_defaults
    TurboOverlay.configure do |c|
      c.modal  { |m| m.frame_id = "custom_modal" }
      c.drawer { |d| d.frame_id = "custom_drawer"; d.position = :top }
    end
    assert_equal "custom_modal",  TurboOverlay.configuration.modal.frame_id
    assert_equal "custom_drawer", TurboOverlay.configuration.drawer.frame_id
    assert_equal :top,            TurboOverlay.configuration.drawer.position

    TurboOverlay.reset_configuration!
    assert_equal "turbo_modal",   TurboOverlay.configuration.modal.frame_id
    assert_equal "turbo_drawer",  TurboOverlay.configuration.drawer.frame_id
    assert_equal :right,          TurboOverlay.configuration.drawer.position
  end
end
