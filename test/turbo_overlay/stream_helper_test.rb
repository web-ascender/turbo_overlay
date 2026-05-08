require "test_helper"
require "turbo_overlay/helpers/stream_helper"

class StreamHelperTest < Minitest::Test
  # Minimal stand-in for Turbo::Streams::TagBuilder. The real class
  # provides #turbo_stream_action_tag; we just need to assert the
  # helper calls through with the right arguments.
  class FakeTagBuilder
    include TurboOverlay::Helpers::StreamHelper

    attr_reader :calls

    def initialize
      @calls = []
    end

    def turbo_stream_action_tag(name, attrs = {})
      @calls << [name, attrs]
      "<turbo-stream action=\"#{name}\" #{attrs.map { |k, v| "#{k}=\"#{v}\"" }.join(" ")}></turbo-stream>"
    end
  end

  def setup
    @builder = FakeTagBuilder.new
  end

  def test_close_emits_overlay_action
    @builder.overlay(:close)
    assert_equal [["overlay", { message: "close" }]], @builder.calls
  end

  def test_hide_alias_emits_overlay_action
    @builder.overlay(:hide)
    assert_equal [["overlay", { message: "close" }]], @builder.calls
  end

  def test_dismiss_alias_emits_overlay_action
    @builder.overlay(:dismiss)
    assert_equal [["overlay", { message: "close" }]], @builder.calls
  end

  def test_unknown_message_raises
    assert_raises(ArgumentError) { @builder.overlay(:explode) }
  end

  def test_accepts_strings_and_mixed_case
    @builder.overlay("Close")
    @builder.overlay("HIDE")
    assert_equal 2, @builder.calls.size
    assert(@builder.calls.all? { |(name, attrs)| name == "overlay" && attrs == { message: "close" } })
  end
end
