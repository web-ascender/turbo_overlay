module TurboOverlay
  module Helpers
    # Adds `turbo_stream.overlay(:close)` (alias `:hide`, `:dismiss`)
    # so server responses can dismiss any open overlay — modal today,
    # drawer in v0.2 — without knowing which one is on screen.
    #
    # Semantically this is "the action that triggered this response is
    # done; close whatever overlay the user was in." If multiple
    # overlays are open they all dismiss.
    module StreamHelper
      def overlay(message)
        case message.to_s.downcase.to_sym
        when :close, :hide, :dismiss
          turbo_stream_action_tag("overlay", message: "close")
        else
          raise ArgumentError, "Unknown overlay message: #{message.inspect} (expected :close, :hide, or :dismiss)"
        end
      end
    end
  end
end
