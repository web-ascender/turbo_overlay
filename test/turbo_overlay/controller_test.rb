require "test_helper"
require "turbo_overlay/controller"

class ControllerTest < Minitest::Test
  # Stand-in for Rails' request object — only the surface the concern
  # touches. `headers` is a plain hash; `format` and `variant` are
  # plain accessors so we can assert the concern mutated them.
  class FakeRequest
    attr_accessor :format, :variant
    attr_reader :headers

    def initialize(headers: {})
      @headers = headers
    end
  end

  class FakeResponse
    attr_accessor :content_type
  end

  # Minimal controller-shaped class that includes the concern. The
  # concern's `included do` block calls Rails class methods
  # (prepend_before_action, after_action, helper_method) — stub them as
  # no-ops so the include succeeds outside of ActionController.
  class FakeController
    def self.prepend_before_action(*); end
    def self.before_action(*); end
    def self.after_action(*); end
    def self.helper_method(*); end
    def self.layout(*); end

    include TurboOverlay::Controller

    attr_accessor :request, :response

    # Stand-in for Turbo::Frames::FrameRequest#turbo_frame_request?,
    # which is auto-included into ActionController::Base by turbo-rails.
    # Reads the Turbo-Frame request header.
    def turbo_frame_request?
      !request.headers["Turbo-Frame"].to_s.empty?
    end
  end

  def setup
    TurboOverlay.reset_configuration!
    @controller = FakeController.new
    @controller.request = FakeRequest.new
    @controller.response = FakeResponse.new
  end

  def teardown
    TurboOverlay.reset_configuration!
  end

  def with_headers(**headers)
    @controller.request = FakeRequest.new(headers: headers)
    @controller
  end

  # ---- type resolution: X-Turbo-Overlay header ----

  def test_modal_request_via_header
    with_headers("X-Turbo-Overlay" => "modal")
    assert_equal :modal, @controller.turbo_overlay_type
    assert @controller.modal_request?
    refute @controller.drawer_request?
    refute @controller.popover_request?
    refute @controller.hint_request?
  end

  def test_drawer_request_via_header
    with_headers("X-Turbo-Overlay" => "drawer")
    assert_equal :drawer, @controller.turbo_overlay_type
    assert @controller.drawer_request?
  end

  def test_popover_request_via_header
    with_headers("X-Turbo-Overlay" => "popover")
    assert_equal :popover, @controller.turbo_overlay_type
    assert @controller.popover_request?
  end

  def test_hint_request_via_header
    with_headers("X-Turbo-Overlay" => "hint")
    assert_equal :hint, @controller.turbo_overlay_type
    assert @controller.hint_request?
  end

  def test_type_is_nil_when_no_header_and_no_turbo_frame
    assert_nil @controller.turbo_overlay_type
    refute @controller.overlay_request?
  end

  def test_unknown_header_value_resolves_to_nil
    with_headers("X-Turbo-Overlay" => "lightbox")
    assert_nil @controller.turbo_overlay_type
  end

  def test_header_value_is_case_insensitive
    with_headers("X-Turbo-Overlay" => "MODAL")
    assert_equal :modal, @controller.turbo_overlay_type
  end

  def test_type_memoized_across_calls
    with_headers("X-Turbo-Overlay" => "modal")
    @controller.turbo_overlay_type
    # Change headers under the hood; memoized result should win.
    @controller.request.headers["X-Turbo-Overlay"] = "drawer"
    assert_equal :modal, @controller.turbo_overlay_type
  end

  # ---- type resolution: Turbo-Frame fallback (form re-render) ----

  def test_modal_request_via_turbo_frame_fallback
    with_headers("Turbo-Frame" => "turbo_overlay_modal_abc123")
    assert_equal :modal, @controller.turbo_overlay_type
  end

  def test_drawer_request_via_turbo_frame_fallback
    with_headers("Turbo-Frame" => "turbo_overlay_drawer_xyz")
    assert_equal :drawer, @controller.turbo_overlay_type
  end

  def test_popover_request_via_turbo_frame_fallback
    with_headers("Turbo-Frame" => "turbo_overlay_popover_xyz")
    assert_equal :popover, @controller.turbo_overlay_type
  end

  def test_unrelated_turbo_frame_does_not_resolve
    with_headers("Turbo-Frame" => "sidebar")
    assert_nil @controller.turbo_overlay_type
  end

  def test_x_turbo_overlay_header_wins_over_turbo_frame
    with_headers("X-Turbo-Overlay" => "modal",
                 "Turbo-Frame" => "turbo_overlay_drawer_xyz")
    assert_equal :modal, @controller.turbo_overlay_type
  end

  # ---- overlay id resolution ----

  def test_overlay_id_from_x_turbo_overlay_id_header
    with_headers("X-Turbo-Overlay" => "modal",
                 "X-Turbo-Overlay-Id" => "edit_user_42")
    assert_equal "edit_user_42", @controller.turbo_overlay_id
  end

  def test_overlay_id_parsed_from_turbo_frame
    with_headers("Turbo-Frame" => "turbo_overlay_modal_xyz123")
    assert_equal "xyz123", @controller.turbo_overlay_id
  end

  def test_overlay_id_generates_random_when_missing
    with_headers("X-Turbo-Overlay" => "modal")
    id = @controller.turbo_overlay_id
    refute_nil id
    assert_kind_of String, id
    assert_equal 8, id.length
  end

  def test_overlay_id_memoized
    with_headers("X-Turbo-Overlay" => "modal")
    first = @controller.turbo_overlay_id
    second = @controller.turbo_overlay_id
    assert_equal first, second
  end

  def test_overlay_id_nil_when_no_overlay
    assert_nil @controller.turbo_overlay_id
  end

  def test_header_id_wins_over_turbo_frame_id
    with_headers("X-Turbo-Overlay" => "modal",
                 "X-Turbo-Overlay-Id" => "explicit",
                 "Turbo-Frame" => "turbo_overlay_modal_implicit")
    assert_equal "explicit", @controller.turbo_overlay_id
  end

  # ---- position / align / offset headers ----

  def test_position_parsed_as_symbol
    with_headers("X-Turbo-Overlay" => "drawer",
                 "X-Turbo-Overlay-Position" => "left")
    assert_equal :left, @controller.turbo_overlay_position
  end

  def test_position_nil_when_header_missing
    with_headers("X-Turbo-Overlay" => "drawer")
    assert_nil @controller.turbo_overlay_position
  end

  def test_align_parsed_as_symbol
    with_headers("X-Turbo-Overlay" => "popover",
                 "X-Turbo-Overlay-Align" => "center")
    assert_equal :center, @controller.turbo_overlay_align
  end

  def test_offset_parsed_as_integer
    with_headers("X-Turbo-Overlay" => "popover",
                 "X-Turbo-Overlay-Offset" => "12")
    assert_equal 12, @controller.turbo_overlay_offset
  end

  def test_offset_returns_nil_for_invalid_value
    with_headers("X-Turbo-Overlay" => "popover",
                 "X-Turbo-Overlay-Offset" => "abc")
    assert_nil @controller.turbo_overlay_offset
  end

  def test_offset_nil_when_header_missing
    with_headers("X-Turbo-Overlay" => "popover")
    assert_nil @controller.turbo_overlay_offset
  end

  # ---- backdrop / close ----

  def test_backdrop_defaults_to_true
    with_headers("X-Turbo-Overlay" => "drawer")
    assert @controller.turbo_overlay_backdrop?
  end

  def test_backdrop_false_when_header_says_false
    with_headers("X-Turbo-Overlay" => "drawer",
                 "X-Turbo-Overlay-Backdrop" => "false")
    refute @controller.turbo_overlay_backdrop?
  end

  def test_close_defaults_to_true
    with_headers("X-Turbo-Overlay" => "modal")
    assert @controller.turbo_overlay_close?
  end

  def test_close_false_when_header_says_false
    with_headers("X-Turbo-Overlay" => "modal",
                 "X-Turbo-Overlay-Close" => "false")
    refute @controller.turbo_overlay_close?
  end

  # ---- prefetch + hintable ----

  def test_prefetch_request_via_x_sec_purpose
    with_headers("X-Sec-Purpose" => "prefetch")
    assert @controller.overlay_prefetch_request?
  end

  def test_prefetch_request_false_when_header_missing
    refute @controller.overlay_prefetch_request?
  end

  def test_prefetch_request_matches_substring
    # Turbo may include other tokens; checking via `include?` covers
    # "prefetch;…" or "prefetch foo".
    with_headers("X-Sec-Purpose" => "prefetch; foo")
    assert @controller.overlay_prefetch_request?
  end

  def test_hintable_request_true_for_hint_type
    with_headers("X-Turbo-Overlay" => "hint")
    assert @controller.overlay_hintable_request?
  end

  def test_hintable_request_true_for_prefetch
    with_headers("X-Sec-Purpose" => "prefetch")
    assert @controller.overlay_hintable_request?
  end

  def test_hintable_request_false_otherwise
    refute @controller.overlay_hintable_request?
  end

  # ---- overlay_request? ----

  def test_overlay_request_true_when_type_present
    with_headers("X-Turbo-Overlay" => "modal")
    assert @controller.overlay_request?
  end

  def test_overlay_request_false_when_no_type
    refute @controller.overlay_request?
  end

  # ---- frame re-render / initial open ----

  def test_frame_re_render_true_when_turbo_frame_matches
    with_headers("Turbo-Frame" => "turbo_overlay_modal_abc")
    assert @controller.turbo_overlay_frame_re_render?
  end

  def test_frame_re_render_false_for_unrelated_frame
    with_headers("Turbo-Frame" => "sidebar")
    refute @controller.turbo_overlay_frame_re_render?
  end

  def test_frame_re_render_false_when_no_turbo_frame
    refute @controller.turbo_overlay_frame_re_render?
  end

  def test_initial_open_true_for_x_turbo_overlay_request
    with_headers("X-Turbo-Overlay" => "modal")
    assert @controller.turbo_overlay_initial_open?
  end

  def test_initial_open_false_when_no_overlay
    refute @controller.turbo_overlay_initial_open?
  end

  def test_initial_open_false_for_frame_re_render
    with_headers("Turbo-Frame" => "turbo_overlay_modal_abc")
    refute @controller.turbo_overlay_initial_open?
  end

  # ---- turbo_overlay_layout ----

  def test_turbo_overlay_layout_returns_modal_layout_for_modal_request
    with_headers("X-Turbo-Overlay" => "modal")
    assert_equal "turbo_overlay/modal", @controller.turbo_overlay_layout
  end

  def test_turbo_overlay_layout_returns_drawer_layout_for_drawer_request
    with_headers("X-Turbo-Overlay" => "drawer")
    assert_equal "turbo_overlay/drawer", @controller.turbo_overlay_layout
  end

  def test_turbo_overlay_layout_returns_popover_layout_for_popover_request
    with_headers("X-Turbo-Overlay" => "popover")
    assert_equal "turbo_overlay/popover", @controller.turbo_overlay_layout
  end

  def test_turbo_overlay_layout_returns_hint_layout_for_hint_request
    with_headers("X-Turbo-Overlay" => "hint")
    assert_equal "turbo_overlay/hint", @controller.turbo_overlay_layout
  end

  def test_turbo_overlay_layout_returns_overlay_layout_for_frame_re_render
    with_headers("Turbo-Frame" => "turbo_overlay_modal_abc")
    assert_equal "turbo_overlay/modal", @controller.turbo_overlay_layout
  end

  def test_turbo_overlay_layout_preserves_turbo_rails_frame_for_plain_frame_request
    with_headers("Turbo-Frame" => "some_plain_frame")
    assert_equal "turbo_rails/frame", @controller.turbo_overlay_layout
  end

  def test_turbo_overlay_layout_returns_nil_for_plain_request
    assert_nil @controller.turbo_overlay_layout
  end

  # ---- _turbo_overlay_force_html_format (before_action body) ----

  def test_force_html_format_on_initial_open
    with_headers("X-Turbo-Overlay" => "modal")
    @controller.send(:_turbo_overlay_force_html_format)
    assert_equal :html, @controller.request.format
  end

  def test_force_html_format_skipped_for_hint_request
    with_headers("X-Turbo-Overlay" => "hint")
    @controller.request.format = :turbo_stream
    @controller.send(:_turbo_overlay_force_html_format)
    assert_equal :turbo_stream, @controller.request.format
  end

  def test_force_html_format_skipped_for_frame_re_render
    # The format must NOT be forced to html on a frame re-render:
    # apps branch their action on format (`respond_to { format.turbo_stream
    # { … }; format.html { redirect_to … } }`), and forcing html here
    # would pick the redirect branch on every successful save — and
    # the followed redirect would render the next page through this
    # concern's overlay layout, morphing it into the open dialog.
    # Implicit `render :edit` calls still resolve `edit.html.erb`
    # via Rails' format-fallback in `request.formats`.
    with_headers("Turbo-Frame" => "turbo_overlay_modal_abc")
    @controller.request.format = :turbo_stream
    @controller.send(:_turbo_overlay_force_html_format)
    assert_equal :turbo_stream, @controller.request.format
  end

  def test_force_html_format_skipped_for_non_overlay_request
    @controller.request.format = :turbo_stream
    @controller.send(:_turbo_overlay_force_html_format)
    assert_equal :turbo_stream, @controller.request.format
  end

  # ---- _turbo_overlay_set_variant (before_action body) ----

  def test_set_variant_sets_request_variant
    with_headers("X-Turbo-Overlay" => "modal")
    @controller.send(:_turbo_overlay_set_variant)
    assert_equal :modal, @controller.request.variant
  end

  def test_set_variant_appends_to_array_variant
    with_headers("X-Turbo-Overlay" => "modal")
    @controller.request.variant = [:phone]
    @controller.send(:_turbo_overlay_set_variant)
    assert_equal [:phone, :modal], @controller.request.variant
  end

  def test_set_variant_does_not_double_append
    with_headers("X-Turbo-Overlay" => "modal")
    @controller.request.variant = [:modal]
    @controller.send(:_turbo_overlay_set_variant)
    assert_equal [:modal], @controller.request.variant
  end

  def test_set_variant_skipped_when_no_overlay
    @controller.request.variant = [:phone]
    @controller.send(:_turbo_overlay_set_variant)
    assert_equal [:phone], @controller.request.variant
  end

  # ---- _turbo_overlay_set_stream_content_type (after_action body) ----

  def test_after_action_sets_turbo_stream_content_type
    with_headers("X-Turbo-Overlay" => "modal")
    @controller.send(:_turbo_overlay_set_stream_content_type)
    assert_equal "text/vnd.turbo-stream.html; charset=utf-8",
      @controller.response.content_type
  end

  def test_after_action_skipped_for_hint_request
    with_headers("X-Turbo-Overlay" => "hint")
    @controller.response.content_type = "text/html"
    @controller.send(:_turbo_overlay_set_stream_content_type)
    assert_equal "text/html", @controller.response.content_type
  end

  def test_after_action_sets_turbo_stream_content_type_on_frame_re_render
    # The morph wrapper emits a `<turbo-stream>` body — Turbo will
    # only process it when the response Content-Type is the
    # turbo-stream mime, so the after_action applies on re-render
    # the same way it does on initial open.
    with_headers("Turbo-Frame" => "turbo_overlay_modal_abc")
    @controller.response.content_type = "text/html"
    @controller.send(:_turbo_overlay_set_stream_content_type)
    assert_equal "text/vnd.turbo-stream.html; charset=utf-8",
      @controller.response.content_type
  end

  def test_after_action_skipped_when_no_response
    with_headers("X-Turbo-Overlay" => "modal")
    @controller.response = nil
    # Should not raise.
    @controller.send(:_turbo_overlay_set_stream_content_type)
  end
end
