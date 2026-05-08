module TurboOverlay
  module Helpers
    # Adds `turbo_stream.overlay(:close, …)` (alias `:hide`,
    # `:dismiss`) so server responses can dismiss open overlays.
    #
    #   turbo_stream.overlay(:close)                              # close top
    #   turbo_stream.overlay(:close, scope: :all)                 # close everything
    #   turbo_stream.overlay(:close, scope: :all, type: :modal)   # close all modals
    #   turbo_stream.overlay(:close, id: "edit_user_42")          # close one by id
    #
    # The custom turbo-stream action dispatches a `turbo-overlay:close`
    # window event with `scope`, `type`, and `id` details; the stack
    # Stimulus controller routes it to the matching overlay(s).
    module StreamHelper
      ALLOWED_MESSAGES = %i[close hide dismiss].freeze
      ALLOWED_SCOPES   = %i[top all].freeze
      ALLOWED_TYPES    = %i[modal drawer].freeze

      def overlay(message = :close, scope: :top, type: nil, id: nil)
        normalized_message = message.to_s.downcase.to_sym
        unless ALLOWED_MESSAGES.include?(normalized_message)
          raise ArgumentError,
            "Unknown overlay message: #{message.inspect} (expected :close, :hide, or :dismiss)"
        end

        normalized_scope = scope.to_s.downcase.to_sym
        unless ALLOWED_SCOPES.include?(normalized_scope)
          raise ArgumentError,
            "Unknown overlay scope: #{scope.inspect} (expected :top or :all)"
        end

        if type
          normalized_type = type.to_s.downcase.to_sym
          unless ALLOWED_TYPES.include?(normalized_type)
            raise ArgumentError,
              "Unknown overlay type: #{type.inspect} (expected :modal or :drawer)"
          end
        end

        attrs = { message: "close" }
        attrs[:scope] = normalized_scope.to_s
        attrs[:type] = normalized_type.to_s if type
        attrs[:"overlay-id"] = id.to_s if id

        turbo_stream_action_tag("overlay", **attrs)
      end
    end
  end
end
