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
    # Pair the close with a host-page navigation via `visit:` —
    # closes the overlay, awaits the close animation, then runs
    # `Turbo.visit` on the host page. Useful for stream-driven
    # flows where there's no form submission to ride a redirect on
    # (ActionCable broadcasts, async job completion):
    #
    #   turbo_stream.overlay(:close, visit: widgets_path)
    #   turbo_stream.overlay(:close, visit: widgets_path, visit_action: :replace)
    #
    # The custom turbo-stream action dispatches a `turbo-overlay:close`
    # window event with `scope`, `type`, `id`, `visit`, and
    # `visitAction` details; the stack Stimulus controller routes the
    # close and performs the visit after the close animation resolves.
    module StreamHelper
      ALLOWED_MESSAGES      = %i[close hide dismiss].freeze
      ALLOWED_SCOPES        = %i[top all].freeze
      # :hint is intentionally absent — hints dismiss client-side on
      # mouseout and don't participate in the server-driven close path.
      ALLOWED_TYPES         = %i[modal drawer popover].freeze
      ALLOWED_VISIT_ACTIONS = %i[advance replace].freeze

      def overlay(message = :close, scope: :top, type: nil, id: nil,
                  visit: nil, visit_action: nil)
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
              "Unknown overlay type: #{type.inspect} (expected :modal, :drawer, or :popover)"
          end
        end

        if visit_action
          normalized_visit_action = visit_action.to_s.downcase.to_sym
          unless ALLOWED_VISIT_ACTIONS.include?(normalized_visit_action)
            raise ArgumentError,
              "Unknown visit_action: #{visit_action.inspect} (expected :advance or :replace)"
          end
        end

        if visit_action && !visit
          raise ArgumentError, "visit_action: requires a visit: URL"
        end

        attrs = { message: "close" }
        attrs[:scope] = normalized_scope.to_s
        attrs[:type] = normalized_type.to_s if type
        attrs[:"overlay-id"] = id.to_s if id
        attrs[:visit] = visit.to_s if visit
        attrs[:"visit-action"] = normalized_visit_action.to_s if visit_action

        turbo_stream_action_tag("overlay", **attrs)
      end
    end
  end
end
