require "test_helper"
require "turbo_overlay/helpers/view_helper"

class ViewHelperTest < Minitest::Test
  class FakeLookupContext
    def initialize(exists:)
      @exists = exists
    end

    def exists?(*_args)
      @exists
    end
  end

  class FakeView
    include TurboOverlay::Helpers::ViewHelper

    attr_reader :link_to_args, :content_for_calls, :modal_request_value, :drawer_request_value
    attr_accessor :_current_overlay_id, :_lookup_context, :_render_returns

    def initialize(modal_request: false, drawer_request: false)
      @modal_request_value  = modal_request
      @drawer_request_value = drawer_request
      @link_to_args = nil
      @content_for_calls = []
      @_current_overlay_id = nil
      @_lookup_context = nil
      @_render_returns = ""
    end

    def lookup_context
      @_lookup_context
    end

    def render(*_args)
      @_render_returns.to_s.html_safe
    end

    def link_to(*args, &block)
      @link_to_args = args
      "<a>stub</a>"
    end

    def content_for(name, value = nil, &block)
      @content_for_calls << [name, value, block]
    end

    def turbo_frame_tag(id, **attrs, &block)
      attr_str = attrs.map { |k, v| %( #{k}="#{v}") }.join
      content = block_given? ? yield : ""
      %(<turbo-frame id="#{id}"#{attr_str}>#{content}</turbo-frame>).html_safe
    end

    def content_tag(tag, content = nil, options = {}, &block)
      content = yield if block_given?
      attrs = options.map do |k, v|
        if v.is_a?(Hash)
          v.map { |kk, vv| %( data-#{kk}="#{vv}") }.join
        else
          %( #{k}="#{v}")
        end
      end.join
      %(<#{tag}#{attrs}>#{content}</#{tag}>).html_safe
    end

    def safe_join(parts)
      parts.join.html_safe
    end

    def modal_request?
      @modal_request_value
    end

    def drawer_request?
      @drawer_request_value
    end

    def controller
      self
    end

    def respond_to?(method_name, include_private = false)
      return true if method_name == :modal_request? || method_name == :drawer_request?
      return true if method_name == :current_overlay_id
      return true if method_name == :turbo_overlay_frame_re_render?
      return true if method_name == :lookup_context
      super
    end

    def current_overlay_id
      @_current_overlay_id
    end

    def turbo_overlay_frame_re_render?
      false
    end

    def turbo_stream
      @turbo_stream ||= FakeTurboStream.new
    end

    def request
      nil
    end
  end

  class FakeTurboStream
    def append(target)
      content = block_given? ? yield : ""
      %(<turbo-stream action="append" target="#{target}"><template>#{content}</template></turbo-stream>)
    end
  end

  def setup
    TurboOverlay.reset_configuration!
  end

  def teardown
    TurboOverlay.reset_configuration!
  end

  # ---- modal_link_to ----

  def test_modal_link_to_adds_turbo_stream_and_overlay_data
    view = FakeView.new
    view.modal_link_to("Open", "/things/1")

    name, options, html_options = view.link_to_args
    assert_equal "Open",      name
    assert_equal "/things/1", options
    assert_equal true,        html_options[:data][:turbo_stream]
    assert_equal "modal",     html_options[:data][:turbo_overlay]
  end

  def test_modal_link_to_with_overlay_id
    view = FakeView.new
    view.modal_link_to("Open", "/things/1", overlay_id: "edit_user_42")

    _, _, html_options = view.link_to_args
    assert_equal "edit_user_42", html_options[:data][:turbo_overlay_id]
  end

  def test_modal_link_to_does_not_set_overlay_id_when_omitted
    view = FakeView.new
    view.modal_link_to("Open", "/things/1")

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_overlay_id)
  end

  def test_modal_link_to_targets_top_to_escape_parent_frame
    view = FakeView.new
    view.modal_link_to("Open", "/things/1")

    _, _, html_options = view.link_to_args
    assert_equal "_top", html_options[:data][:turbo_frame]
  end

  def test_modal_link_to_respects_explicit_turbo_frame_data
    view = FakeView.new
    view.modal_link_to("Open", "/things/1", data: { turbo_frame: "sidebar" })

    _, _, html_options = view.link_to_args
    assert_equal "sidebar", html_options[:data][:turbo_frame]
  end

  def test_modal_link_to_respects_explicit_data_turbo_frame_attribute
    view = FakeView.new
    view.modal_link_to("Open", "/things/1", "data-turbo-frame" => "sidebar")

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_frame)
    assert_equal "sidebar", html_options["data-turbo-frame"]
  end

  # ---- modal_dismiss_link_to ----

  def test_modal_dismiss_link_to_inside_modal_adds_dismiss_action
    view = FakeView.new(modal_request: true)
    view.modal_dismiss_link_to("Cancel", "/back")

    _, _, html_options = view.link_to_args
    assert_includes html_options["data-action"], "click->turbo-overlay#close"
    assert_equal "true", html_options["data-turbo-modal-dismiss"]
  end

  def test_modal_dismiss_link_to_outside_modal_is_plain_link
    view = FakeView.new(modal_request: false)
    view.modal_dismiss_link_to("Cancel", "/back")

    _, _, html_options = view.link_to_args
    refute html_options.key?("data-action")
    refute html_options.key?("data-turbo-modal-dismiss")
  end

  # ---- drawer_link_to ----

  def test_drawer_link_to_adds_turbo_stream_and_overlay_data
    view = FakeView.new
    view.drawer_link_to("Filter", "/filters")

    _, _, html_options = view.link_to_args
    assert_equal true,     html_options[:data][:turbo_stream]
    assert_equal "drawer", html_options[:data][:turbo_overlay]
  end

  def test_drawer_link_to_with_position_sets_data_attribute
    view = FakeView.new
    view.drawer_link_to("Filter", "/filters", position: :left)

    _, _, html_options = view.link_to_args
    assert_equal "left", html_options[:data][:turbo_overlay_position]
  end

  def test_drawer_link_to_omits_position_when_not_provided
    view = FakeView.new
    view.drawer_link_to("Filter", "/filters")

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_overlay_position)
  end

  def test_drawer_link_to_with_backdrop_false_sets_data_attribute
    view = FakeView.new
    view.drawer_link_to("Inspector", "/inspect", backdrop: false)

    _, _, html_options = view.link_to_args
    assert_equal "false", html_options[:data][:turbo_overlay_backdrop]
  end

  def test_drawer_link_to_with_backdrop_true_omits_data_attribute
    view = FakeView.new
    view.drawer_link_to("Inspector", "/inspect", backdrop: true)

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_overlay_backdrop)
  end

  def test_drawer_link_to_omits_backdrop_attribute_when_not_provided
    view = FakeView.new
    view.drawer_link_to("Filter", "/filters")

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_overlay_backdrop)
  end

  # ---- drawer_dismiss_link_to ----

  def test_drawer_dismiss_link_to_inside_drawer_adds_dismiss_action
    view = FakeView.new(drawer_request: true)
    view.drawer_dismiss_link_to("Close", "/back")

    _, _, html_options = view.link_to_args
    assert_includes html_options["data-action"], "click->turbo-overlay#close"
    assert_equal "true", html_options["data-turbo-drawer-dismiss"]
  end

  def test_drawer_dismiss_link_to_outside_drawer_is_plain_link
    view = FakeView.new(drawer_request: false)
    view.drawer_dismiss_link_to("Close", "/back")

    _, _, html_options = view.link_to_args
    refute html_options.key?("data-action")
    refute html_options.key?("data-turbo-drawer-dismiss")
  end

  # ---- overlay_stack_tag ----

  def test_overlay_stack_tag_emits_stack_container
    view = FakeView.new
    output = view.overlay_stack_tag
    assert_includes output, %(id="turbo_overlay_stack")
    assert_includes output, %(data-controller="turbo-overlay-stack")
  end

  def test_overlay_stack_tag_uses_configured_stack_id
    TurboOverlay.configure { |c| c.stack_id = "my_stack" }
    view = FakeView.new
    output = view.overlay_stack_tag
    assert_includes output, %(id="my_stack")
  end

  def test_overlay_stack_tag_omits_confirm_template_when_partial_missing
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: false)
    output = view.overlay_stack_tag
    refute_includes output, %(turbo_overlay_confirm_template)
  end

  def test_overlay_stack_tag_emits_confirm_template_when_partial_present
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: true)
    view._render_returns = %(<dialog data-controller="turbo-overlay">CONFIRM_BODY</dialog>)
    output = view.overlay_stack_tag
    assert_includes output, %(<template id="turbo_overlay_confirm_template">)
    assert_includes output, %(CONFIRM_BODY)
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
