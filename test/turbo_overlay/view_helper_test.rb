require "test_helper"
require "turbo_overlay/helpers/view_helper"

class ViewHelperTest < Minitest::Test
  # Stand-in view context. Captures arguments passed to link_to /
  # content_for so we can assert what the helpers forward.
  class FakeView
    include TurboOverlay::Helpers::ViewHelper

    attr_reader :link_to_args, :content_for_calls, :modal_request_value

    def initialize(modal_request: false)
      @modal_request_value = modal_request
      @link_to_args = nil
      @content_for_calls = []
    end

    def link_to(*args, &block)
      @link_to_args = args
      "<a>stub</a>"
    end

    def content_for(name, value = nil, &block)
      @content_for_calls << [name, value, block]
    end

    def modal_request?
      @modal_request_value
    end

    def controller
      nil
    end

    def request
      nil
    end
  end

  def setup
    TurboOverlay.reset_configuration!
  end

  def teardown
    TurboOverlay.reset_configuration!
  end

  # ---- modal_link_to ----

  def test_modal_link_to_adds_turbo_frame_data
    view = FakeView.new
    view.modal_link_to("Open", "/things/1")

    name, options, html_options = view.link_to_args
    assert_equal "Open",       name
    assert_equal "/things/1",  options
    assert_equal({ turbo_frame: "turbo_modal" }, html_options[:data])
  end

  def test_modal_link_to_respects_existing_data_turbo_frame
    view = FakeView.new
    view.modal_link_to("Open", "/things/1", data: { turbo_frame: "_top" })

    _, _, html_options = view.link_to_args
    assert_equal "_top", html_options[:data][:turbo_frame]
  end

  def test_modal_link_to_uses_configured_frame_id
    TurboOverlay.configure { |c| c.modal { |m| m.frame_id = "my_modal" } }
    view = FakeView.new
    view.modal_link_to("Open", "/things/1")

    _, _, html_options = view.link_to_args
    assert_equal({ turbo_frame: "my_modal" }, html_options[:data])
  end

  # ---- modal_dismiss_link_to ----

  def test_modal_dismiss_link_to_inside_modal_adds_dismiss_action
    view = FakeView.new(modal_request: true)
    view.modal_dismiss_link_to("Cancel", "/back")

    _, _, html_options = view.link_to_args
    assert_includes html_options["data-action"], "click->turbo-modal#close"
    assert_equal "true", html_options["data-turbo-modal-dismiss"]
  end

  def test_modal_dismiss_link_to_outside_modal_is_plain_link
    view = FakeView.new(modal_request: false)
    view.modal_dismiss_link_to("Cancel", "/back")

    _, _, html_options = view.link_to_args
    refute html_options.key?("data-action")
    refute html_options.key?("data-turbo-modal-dismiss")
  end

  # ---- generic in-view content helpers ----

  def test_overlay_title_with_value
    view = FakeView.new
    view.overlay_title("New User")

    name, value, _block = view.content_for_calls.first
    assert_equal :overlay_title, name
    assert_equal "New User", value
  end

  def test_overlay_title_with_block
    view = FakeView.new
    view.overlay_title { "<i>fancy</i>" }

    name, value, block = view.content_for_calls.first
    assert_equal :overlay_title, name
    assert_nil value
    assert_kind_of Proc, block
  end

  def test_overlay_footer_with_block
    view = FakeView.new
    view.overlay_footer { "buttons" }

    name, _value, block = view.content_for_calls.first
    assert_equal :overlay_footer, name
    assert_kind_of Proc, block
  end
end
