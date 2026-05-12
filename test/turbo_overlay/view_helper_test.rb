require "test_helper"
require "turbo_overlay/helpers/view_helper"

class ViewHelperTest < Minitest::Test
  class FakeLookupContext
    # `exists:` accepts:
    #   - true / false → all queries return that value
    #   - Array of variant symbols → those variants exist for any
    #     partial; the no-variant ("shared") query returns false.
    #   - Hash `{ variants: [:modal], shared: true }` → both axes.
    #   - Hash keyed by partial path (e.g.
    #     `{ "turbo_overlay/confirm" => { variants: [:modal] } }`) →
    #     per-partial fine-grained control. Unmatched partials are
    #     treated as absent.
    def initialize(exists:)
      @exists = exists
    end

    def exists?(name, _prefixes = [], _partial = false, _keys = [], **details)
      variants = details[:variants] || []

      spec = if @exists.is_a?(Hash) && (@exists.key?(name) || @exists.key?(:_default))
        @exists[name] || @exists[:_default] || false
      else
        @exists
      end

      _resolve_exists(spec, variants)
    end

    # Minimal mirror of ActionView::LookupContext#find_all — returns
    # an array of FakeTemplate objects whose `identifier` includes the
    # matched variant (`+hint.`, etc.) so callers can distinguish a
    # real variant match from a no-variant fallback.
    FakeTemplate = Struct.new(:identifier)

    def find_all(name, _prefixes = [], _partial = false, _keys = [], **details)
      variants = details[:variants] || []
      spec = if @exists.is_a?(Hash) && (@exists.key?(name) || @exists.key?(:_default))
        @exists[name] || @exists[:_default] || false
      else
        @exists
      end

      results = []

      case spec
      when true
        results << FakeTemplate.new("#{name}.html.erb")
      when false
        # nothing
      when Hash
        Array(spec[:variants]).each do |v|
          next unless variants.empty? || variants.include?(v)
          results << FakeTemplate.new("#{name}.html+#{v}.erb")
        end
        results << FakeTemplate.new("#{name}.html.erb") if spec[:shared]
      when Array
        spec.each do |v|
          next unless variants.empty? || variants.include?(v)
          results << FakeTemplate.new("#{name}.html+#{v}.erb")
        end
      end

      results
    end

    private

    def _resolve_exists(spec, variants)
      return spec if spec == true || spec == false

      if spec.is_a?(Hash)
        return spec[:shared] == true if variants.empty?
        return variants.any? { |v| Array(spec[:variants]).include?(v) }
      end

      return false if variants.empty?
      variants.any? { |v| spec.include?(v) }
    end
  end

  class FakeView
    include TurboOverlay::Helpers::ViewHelper

    attr_reader :link_to_args, :content_for_calls, :modal_request_value, :drawer_request_value, :popover_request_value
    attr_accessor :_turbo_overlay_id, :_lookup_context, :_render_returns, :_hintable_request, :_controller_path, :_action_name

    def initialize(modal_request: false, drawer_request: false, popover_request: false, hintable_request: true, controller_path: "users", action_name: "show")
      # Default `hintable_request: true` so the existing hint-emission
      # tests don't have to opt in. Tests that exercise the non-hintable
      # path pass `hintable_request: false`.
      @_hintable_request     = hintable_request
      @_controller_path      = controller_path
      @_action_name          = action_name
      @modal_request_value   = modal_request
      @drawer_request_value  = drawer_request
      @popover_request_value = popover_request
      @link_to_args = nil
      @content_for_calls = []
      @_turbo_overlay_id = nil
      @_lookup_context = nil
      @_render_returns = ""
    end

    def lookup_context
      @_lookup_context
    end

    def render(*_args, **_kwargs)
      @_render_returns.to_s.html_safe
    end

    def link_to(*args, &block)
      @link_to_args = args
      "<a>stub</a>"
    end

    def content_for(name, value = nil, &block)
      @content_for_calls << [name, value, block]
      @_captured ||= {}
      if block || value
        stored = block ? block.call : value
        @_captured[name] = stored
        stored
      else
        @_captured[name]
      end
    end

    def content_for?(name)
      @_captured && @_captured.key?(name)
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

    def popover_request?
      @popover_request_value
    end

    def hint_request?
      false
    end

    def turbo_overlay_type
      return :modal   if @modal_request_value
      return :drawer  if @drawer_request_value
      return :popover if @popover_request_value
      nil
    end

    def turbo_overlay_position; nil; end
    def turbo_overlay_align;    nil; end
    def turbo_overlay_offset;   nil; end
    def turbo_overlay_backdrop?; true; end
    def turbo_overlay_close?;    true; end

    def controller
      self
    end

    def turbo_overlay_hintable_request?
      @_hintable_request
    end

    def controller_path
      @_controller_path
    end

    def action_name
      @_action_name
    end

    def turbo_overlay_id
      @_turbo_overlay_id
    end

    def turbo_overlay_frame_re_render?
      false
    end

    def turbo_stream
      @turbo_stream ||= FakeTurboStream.new
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

  def test_modal_link_to_with_close_false_sets_data_attribute
    view = FakeView.new
    view.modal_link_to("Open", "/things/1", close: false)

    _, _, html_options = view.link_to_args
    assert_equal "false", html_options[:data][:turbo_overlay_close]
  end

  def test_drawer_link_to_with_close_false_sets_data_attribute
    view = FakeView.new
    view.drawer_link_to("Filter", "/filters", close: false)

    _, _, html_options = view.link_to_args
    assert_equal "false", html_options[:data][:turbo_overlay_close]
  end

  def test_drawer_link_to_with_close_true_omits_data_attribute
    view = FakeView.new
    view.drawer_link_to("Filter", "/filters", close: true)

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_overlay_close)
  end

  def test_modal_link_to_omits_close_attribute_when_not_provided
    view = FakeView.new
    view.modal_link_to("Open", "/things/1")

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_overlay_close)
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
    assert_match(/data-controller="turbo-overlay-stack(\s+turbo-overlay-hint)?"/, output)
  end

  def test_overlay_stack_tag_uses_configured_stack_id
    TurboOverlay.configure { |c| c.stack_id = "my_stack" }
    view = FakeView.new
    output = view.overlay_stack_tag
    assert_includes output, %(id="my_stack")
  end

  def test_overlay_stack_tag_omits_confirm_templates_when_partials_missing
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: false)
    output = view.overlay_stack_tag
    refute_includes output, %(turbo_overlay_confirm_modal_template)
    refute_includes output, %(turbo_overlay_confirm_popover_template)
  end

  def test_overlay_stack_tag_emits_modal_confirm_template_when_partial_present
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: [:modal])
    view._render_returns = %(<dialog data-controller="turbo-overlay">CONFIRM_BODY</dialog>)
    output = view.overlay_stack_tag
    assert_includes output, %(<template id="turbo_overlay_confirm_modal_template">)
    refute_includes output, %(turbo_overlay_confirm_popover_template)
    assert_includes output, %(CONFIRM_BODY)
  end

  def test_overlay_stack_tag_emits_popover_confirm_template_when_partial_present
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: [:popover])
    view._render_returns = %(<dialog data-controller="turbo-overlay">CONFIRM_BODY</dialog>)
    output = view.overlay_stack_tag
    assert_includes output, %(<template id="turbo_overlay_confirm_popover_template">)
    refute_includes output, %(turbo_overlay_confirm_modal_template)
  end

  def test_overlay_stack_tag_emits_both_variant_templates_when_present
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: [:modal, :popover])
    view._render_returns = %(<dialog data-controller="turbo-overlay">CONFIRM_BODY</dialog>)
    output = view.overlay_stack_tag
    assert_includes output, %(<template id="turbo_overlay_confirm_modal_template">)
    assert_includes output, %(<template id="turbo_overlay_confirm_popover_template">)
  end

  def test_overlay_stack_tag_emits_both_confirm_variants_from_shared_partial
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: {
      "turbo_overlay/confirm" => { variants: [], shared: true }
    })
    view._render_returns = %(<dialog data-controller="turbo-overlay">SHARED_CONFIRM</dialog>)
    output = view.overlay_stack_tag
    assert_includes output, %(<template id="turbo_overlay_confirm_modal_template">)
    assert_includes output, %(<template id="turbo_overlay_confirm_popover_template">)
    # Shared body rendered into both confirm templates.
    assert_equal 2, output.scan("SHARED_CONFIRM").size
  end

  def test_overlay_stack_tag_emits_loading_templates_per_variant
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: {
      "turbo_overlay/loading" => { variants: [:modal, :drawer, :popover, :hint], shared: false }
    })
    view._render_returns = %(<dialog data-controller="turbo-overlay">LOADING_BODY</dialog>)
    output = view.overlay_stack_tag
    assert_includes output, %(<template id="turbo_overlay_loading_modal_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_drawer_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_popover_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_hint_template">)
  end

  def test_overlay_stack_tag_emits_loading_templates_from_shared_partial
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: {
      "turbo_overlay/loading" => { variants: [], shared: true }
    })
    view._render_returns = %(<dialog data-controller="turbo-overlay">SHARED_LOADING</dialog>)
    output = view.overlay_stack_tag
    # All four loading templates emitted from the single shared partial.
    assert_includes output, %(<template id="turbo_overlay_loading_modal_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_drawer_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_popover_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_hint_template">)
    assert_equal 4, output.scan("SHARED_LOADING").size
  end

  def test_overlay_stack_tag_omits_loading_templates_when_partials_missing
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: false)
    output = view.overlay_stack_tag
    refute_includes output, %(turbo_overlay_loading_modal_template)
    refute_includes output, %(turbo_overlay_loading_drawer_template)
    refute_includes output, %(turbo_overlay_loading_popover_template)
    refute_includes output, %(turbo_overlay_loading_hint_template)
  end

  def test_overlay_stack_tag_prefers_variant_loading_partial_over_shared
    view = FakeView.new
    view._lookup_context = FakeLookupContext.new(exists: {
      "turbo_overlay/loading" => { variants: [:modal], shared: true }
    })
    view._render_returns = %(<dialog data-controller="turbo-overlay">LOADING</dialog>)
    output = view.overlay_stack_tag
    # All four are emitted; modal from variant, others from shared.
    assert_includes output, %(<template id="turbo_overlay_loading_modal_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_drawer_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_popover_template">)
    assert_includes output, %(<template id="turbo_overlay_loading_hint_template">)
  end

  def test_overlay_stack_tag_emits_default_confirm_style_data_attribute
    view = FakeView.new
    output = view.overlay_stack_tag
    assert_includes output, %(data-turbo-overlay-confirm-style="modal")
  end

  def test_overlay_stack_tag_reflects_configured_confirm_style
    TurboOverlay.configure { |c| c.confirm { |cf| cf.style = :popover } }
    view = FakeView.new
    output = view.overlay_stack_tag
    assert_includes output, %(data-turbo-overlay-confirm-style="popover")
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

  # ---- overlay_close / overlay_close? ----

  def test_overlay_close_defaults_to_true
    view = FakeView.new
    assert view.overlay_close?
  end

  def test_overlay_close_false_disables
    view = FakeView.new
    view.overlay_close false
    refute view.overlay_close?
  end

  def test_overlay_close_true_explicit_enables
    view = FakeView.new
    view.overlay_close true
    assert view.overlay_close?
  end

  def test_overlay_close_predicate_ivar_wins_over_controller
    view = FakeView.new
    def view.turbo_overlay_close?; false; end
    def view.respond_to?(name, *); name == :turbo_overlay_close? || super; end
    view.overlay_close true
    assert view.overlay_close?
  end

  def test_overlay_close_predicate_falls_back_to_controller
    view = FakeView.new
    def view.turbo_overlay_close?; false; end
    def view.respond_to?(name, *); name == :turbo_overlay_close? || super; end
    refute view.overlay_close?
  end

  # ---- popover_link_to ----

  def test_popover_link_to_adds_turbo_stream_and_overlay_data
    view = FakeView.new
    view.popover_link_to("Edit", "/things/1")

    _, _, html_options = view.link_to_args
    assert_equal true,      html_options[:data][:turbo_stream]
    assert_equal "popover", html_options[:data][:turbo_overlay]
  end

  def test_popover_link_to_targets_top_to_escape_parent_frame
    view = FakeView.new
    view.popover_link_to("Edit", "/things/1")

    _, _, html_options = view.link_to_args
    assert_equal "_top", html_options[:data][:turbo_frame]
  end

  def test_popover_link_to_with_position_sets_data_attribute
    view = FakeView.new
    view.popover_link_to("Edit", "/things/1", position: :top)

    _, _, html_options = view.link_to_args
    assert_equal "top", html_options[:data][:turbo_overlay_position]
  end

  def test_popover_link_to_with_align_sets_data_attribute
    view = FakeView.new
    view.popover_link_to("Edit", "/things/1", align: :center)

    _, _, html_options = view.link_to_args
    assert_equal "center", html_options[:data][:turbo_overlay_align]
  end

  def test_popover_link_to_with_offset_sets_data_attribute
    view = FakeView.new
    view.popover_link_to("Edit", "/things/1", offset: 12)

    _, _, html_options = view.link_to_args
    assert_equal "12", html_options[:data][:turbo_overlay_offset]
  end

  def test_popover_link_to_omits_align_and_offset_when_not_provided
    view = FakeView.new
    view.popover_link_to("Edit", "/things/1")

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_overlay_align)
    refute html_options[:data].key?(:turbo_overlay_offset)
  end

  def test_modal_link_to_accepts_align_and_offset_for_hint_composition
    # The hint phase will use these on overlay links; ensure they're
    # carried through cleanly even on modal/drawer links.
    view = FakeView.new
    view.modal_link_to("Open", "/things/1", align: :end, offset: 6)

    _, _, html_options = view.link_to_args
    assert_equal "end", html_options[:data][:turbo_overlay_align]
    assert_equal "6",   html_options[:data][:turbo_overlay_offset]
  end

  # ---- popover_dismiss_link_to ----

  def test_popover_dismiss_link_to_inside_popover_adds_dismiss_action
    view = FakeView.new(popover_request: true)
    view.popover_dismiss_link_to("Close", "/back")

    _, _, html_options = view.link_to_args
    assert_includes html_options["data-action"], "click->turbo-overlay#close"
    assert_equal "true", html_options["data-turbo-popover-dismiss"]
  end

  def test_popover_dismiss_link_to_outside_popover_is_plain_link
    view = FakeView.new(popover_request: false)
    view.popover_dismiss_link_to("Close", "/back")

    _, _, html_options = view.link_to_args
    refute html_options.key?("data-action")
    refute html_options.key?("data-turbo-popover-dismiss")
  end

  # ---- hint_link_to ----

  def test_hint_link_to_sets_data_attribute
    view = FakeView.new
    view.hint_link_to("User", "/users/1")

    _, _, html_options = view.link_to_args
    assert_equal "true", html_options[:data][:turbo_overlay_hint]
  end

  def test_hint_link_to_with_hint_url_sets_url_attribute
    view = FakeView.new
    view.hint_link_to("User", "/users/1", hint_url: "/users/1/hint")

    _, _, html_options = view.link_to_args
    assert_equal "/users/1/hint", html_options[:data][:turbo_overlay_hint_url]
  end

  def test_hint_link_to_does_not_set_turbo_stream_or_top_frame
    # hint_link_to is meant to be a plain navigation link with a hover
    # preview — not an overlay-opening link.
    view = FakeView.new
    view.hint_link_to("User", "/users/1")

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_stream)
    refute html_options[:data].key?(:turbo_frame)
  end

  # ---- hint composition on overlay link helpers ----

  def test_modal_link_to_with_hint_true_sets_data_attribute
    view = FakeView.new
    view.modal_link_to("Edit", "/edit", hint: true)

    _, _, html_options = view.link_to_args
    assert_equal "true", html_options[:data][:turbo_overlay_hint]
  end

  def test_modal_link_to_with_hint_url_sets_url_attribute
    view = FakeView.new
    view.modal_link_to("Edit", "/edit", hint: true, hint_url: "/edit/hint")

    _, _, html_options = view.link_to_args
    assert_equal "true",       html_options[:data][:turbo_overlay_hint]
    assert_equal "/edit/hint", html_options[:data][:turbo_overlay_hint_url]
  end

  def test_drawer_link_to_with_hint_true_sets_data_attribute
    view = FakeView.new
    view.drawer_link_to("Filters", "/filters", hint: true)

    _, _, html_options = view.link_to_args
    assert_equal "true", html_options[:data][:turbo_overlay_hint]
  end

  def test_popover_link_to_with_hint_true_sets_data_attribute
    view = FakeView.new
    view.popover_link_to("Edit", "/edit", hint: true)

    _, _, html_options = view.link_to_args
    assert_equal "true", html_options[:data][:turbo_overlay_hint]
  end

  def test_overlay_link_omits_hint_attributes_when_not_provided
    view = FakeView.new
    view.modal_link_to("Edit", "/edit")

    _, _, html_options = view.link_to_args
    refute html_options[:data].key?(:turbo_overlay_hint)
    refute html_options[:data].key?(:turbo_overlay_hint_url)
  end

  # ---- auto-render +hint variant template ----

  def test_overlay_stack_tag_auto_renders_action_hint_variant
    view = FakeView.new(controller_path: "users", action_name: "show")
    view._lookup_context = FakeLookupContext.new(exists: {
      "users/show" => { variants: [:hint] }
    })
    view._render_returns = "AUTO_HINT_BODY"
    output = view.overlay_stack_tag
    assert_includes output, %(<template id="turbo-overlay-hint">)
    assert_includes output, "AUTO_HINT_BODY"
  end

  def test_overlay_stack_tag_skips_auto_hint_on_non_hintable_request
    view = FakeView.new(hintable_request: false,
                        controller_path: "users", action_name: "show")
    view._lookup_context = FakeLookupContext.new(exists: {
      "users/show" => { variants: [:hint] }
    })
    view._render_returns = "AUTO_HINT_BODY"
    output = view.overlay_stack_tag
    refute_includes output, %(<template id="turbo-overlay-hint">)
    refute_includes output, "AUTO_HINT_BODY"
  end

  def test_overlay_stack_tag_skips_auto_hint_when_no_variant_template
    view = FakeView.new(controller_path: "users", action_name: "show")
    view._lookup_context = FakeLookupContext.new(exists: false)
    view._render_returns = "AUTO_HINT_BODY"
    output = view.overlay_stack_tag
    refute_includes output, %(<template id="turbo-overlay-hint">)
    refute_includes output, "AUTO_HINT_BODY"
  end

  def test_overlay_stack_tag_skips_auto_hint_when_only_base_template_exists
    # Regression: without strict variant detection, the whole page's
    # show.html.erb would be rendered as the hint body whenever an
    # action had any view template at all.
    view = FakeView.new(controller_path: "users", action_name: "show")
    view._lookup_context = FakeLookupContext.new(exists: {
      "users/show" => { variants: [], shared: true }  # only show.html.erb, no +hint
    })
    view._render_returns = "FULL_PAGE_BODY"
    output = view.overlay_stack_tag
    refute_includes output, %(<template id="turbo-overlay-hint">)
    refute_includes output, "FULL_PAGE_BODY"
  end

  def test_overlay_stack_tag_omits_hint_template_without_variant
    view = FakeView.new
    output = view.overlay_stack_tag
    refute_includes output, %(<template id="turbo-overlay-hint">)
  end

  def test_overlay_stack_tag_exposes_hint_delays
    view = FakeView.new
    output = view.overlay_stack_tag
    assert_includes output, "data-turbo-overlay-hint-show-delay"
    assert_includes output, "data-turbo-overlay-hint-hide-delay"
  end
end
