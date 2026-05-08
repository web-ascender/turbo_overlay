require "test_helper"

class ConfigurationTest < Minitest::Test
  def setup
    TurboOverlay.reset_configuration!
  end

  def teardown
    TurboOverlay.reset_configuration!
  end

  def test_default_modal_values
    modal = TurboOverlay.configuration.modal
    assert_equal "turbo_modal", modal.frame_id
    assert_equal :modal,        modal.variant
    assert_equal "turbo_modal", modal.layout_name
    assert_equal "turbo-modal", modal.stimulus_identifier
  end

  def test_configure_block_with_yield
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

  def test_modal_returns_config_when_no_block_given
    assert_instance_of TurboOverlay::OverlayTypeConfig, TurboOverlay.configuration.modal
  end

  def test_reset_configuration_restores_defaults
    TurboOverlay.configure { |c| c.modal { |m| m.frame_id = "custom" } }
    assert_equal "custom", TurboOverlay.configuration.modal.frame_id

    TurboOverlay.reset_configuration!
    assert_equal "turbo_modal", TurboOverlay.configuration.modal.frame_id
  end
end
