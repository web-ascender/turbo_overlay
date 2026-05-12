require "active_support/concern"
require "securerandom"

module TurboOverlay
  # Controller concern. Include in `ApplicationController` (or any
  # controller you want overlay-aware).
  #
  # Layout swapping uses standard Rails. Pick a layout method and
  # return the matching overlay layout for overlay requests:
  #
  #   class ApplicationController < ActionController::Base
  #     include TurboOverlay::Controller
  #     layout :resolve_layout
  #
  #     private
  #
  #     def resolve_layout
  #       return modal_layout_name  if modal_request?
  #       return drawer_layout_name if drawer_request?
  #       "application"
  #     end
  #   end
  #
  # The overlay layout *replaces* the application layout for overlay
  # requests — only the view content gets wrapped in the overlay
  # markup, not the host page's chrome.
  module Controller
    extend ActiveSupport::Concern

    OVERLAY_FRAME_PREFIX    = "turbo_overlay_".freeze
    OVERLAY_TYPE_HEADER     = "X-Turbo-Overlay".freeze
    OVERLAY_ID_HEADER       = "X-Turbo-Overlay-Id".freeze
    OVERLAY_POSITION_HEADER = "X-Turbo-Overlay-Position".freeze
    OVERLAY_ALIGN_HEADER    = "X-Turbo-Overlay-Align".freeze
    OVERLAY_OFFSET_HEADER   = "X-Turbo-Overlay-Offset".freeze
    OVERLAY_BACKDROP_HEADER = "X-Turbo-Overlay-Backdrop".freeze
    OVERLAY_CLOSE_HEADER    = "X-Turbo-Overlay-Close".freeze

    included do
      prepend_before_action :_turbo_overlay_force_html_format
      prepend_before_action :_turbo_overlay_set_variant
      after_action :_turbo_overlay_set_stream_content_type

      helper_method :modal_request?, :modal_layout_name,
        :drawer_request?, :drawer_layout_name,
        :popover_request?, :popover_layout_name,
        :hint_request?, :hint_layout_name,
        :overlay_request?, :turbo_overlay_id, :turbo_overlay_type,
        :turbo_overlay_position, :turbo_overlay_align,
        :turbo_overlay_offset, :turbo_overlay_backdrop?,
        :turbo_overlay_close?, :turbo_overlay_prefetch_request?,
        :turbo_overlay_hintable_request?
    end

    # ----- modal -----

    def modal_request?
      turbo_overlay_type == :modal
    end

    def modal_layout_name
      TurboOverlay.configuration.modal.layout_name
    end

    # ----- drawer -----

    def drawer_request?
      turbo_overlay_type == :drawer
    end

    def drawer_layout_name
      TurboOverlay.configuration.drawer.layout_name
    end

    # ----- popover -----

    def popover_request?
      turbo_overlay_type == :popover
    end

    def popover_layout_name
      TurboOverlay.configuration.popover.layout_name
    end

    # ----- hint -----

    def hint_request?
      turbo_overlay_type == :hint
    end

    def hint_layout_name
      TurboOverlay.configuration.hint.layout_name
    end

    # ----- generic -----

    # True if the current request targets *any* configured overlay
    # (initial open or in-overlay form re-render). Useful in shared
    # partials.
    def overlay_request?
      !turbo_overlay_type.nil?
    end

    # True if the current request is a Turbo hover prefetch. Detected
    # via the `X-Sec-Purpose: prefetch` request header that Turbo
    # sends — the W3C `Sec-Purpose` is a Forbidden Header for
    # JS-initiated `fetch()` requests, so Turbo prepends `X-`. Used
    # by `turbo_overlay_hint` to skip its block on regular page
    # renders.
    def turbo_overlay_prefetch_request?
      return false unless respond_to?(:request) && request
      request.headers["X-Sec-Purpose"].to_s.include?("prefetch")
    end

    # True if the current request will use the hint template the page
    # captures via `turbo_overlay_hint do … end` — either a hover
    # prefetch (which the gem's JS extracts the template from) or an
    # explicit `:hint` variant fetch.
    def turbo_overlay_hintable_request?
      hint_request? || turbo_overlay_prefetch_request?
    end

    # Returns `:modal`, `:drawer`, `:popover`, or `nil`. Detected from
    # the `X-Turbo-Overlay` request header (initial open) or the
    # `Turbo-Frame: turbo_overlay_<type>_<id>` header (form re-render
    # inside an open overlay).
    def turbo_overlay_type
      return @_turbo_overlay_type if defined?(@_turbo_overlay_type)
      @_turbo_overlay_type = _resolve_overlay_type
    end

    # The overlay id for the current request. Resolution order:
    #
    # 1. `X-Turbo-Overlay-Id` request header (caller supplied
    #    `overlay_id:` on the link helper)
    # 2. The `<id>` segment parsed from a
    #    `Turbo-Frame: turbo_overlay_<type>_<id>` header (form re-render)
    # 3. A freshly generated `SecureRandom.alphanumeric(8)` id,
    #    memoized for the duration of the request
    #
    # Available in the controller and in views (e.g. for
    # `turbo_stream.overlay(:close, id: turbo_overlay_id)`).
    def turbo_overlay_id
      return @_turbo_overlay_id if defined?(@_turbo_overlay_id)
      @_turbo_overlay_id = _resolve_overlay_id
    end

    # The per-link position override for the current overlay request,
    # parsed from the `X-Turbo-Overlay-Position` header. Returns a
    # Symbol (`:left`, `:right`, `:top`, `:bottom`) or `nil` when the
    # link didn't supply one. Drawer partials use this with a
    # fallback to `TurboOverlay.configuration.drawer.position`;
    # popover partials use it with a fallback to
    # `TurboOverlay.configuration.popover.position`.
    def turbo_overlay_position
      return @_turbo_overlay_position if defined?(@_turbo_overlay_position)
      @_turbo_overlay_position = _resolve_overlay_position
    end

    # The per-link cross-axis alignment for popovers, parsed from the
    # `X-Turbo-Overlay-Align` header. Returns a Symbol (`:start`,
    # `:center`, `:end`) or `nil`. Popover partials fall back to
    # `TurboOverlay.configuration.popover.align`.
    def turbo_overlay_align
      return @_turbo_overlay_align if defined?(@_turbo_overlay_align)
      @_turbo_overlay_align = _resolve_overlay_align
    end

    # The per-link pixel offset between trigger and popover, parsed
    # from the `X-Turbo-Overlay-Offset` header. Returns an Integer or
    # `nil`. Popover partials fall back to
    # `TurboOverlay.configuration.popover.offset`.
    def turbo_overlay_offset
      return @_turbo_overlay_offset if defined?(@_turbo_overlay_offset)
      @_turbo_overlay_offset = _resolve_overlay_offset
    end

    # Whether the current overlay request should render with a
    # backdrop. Defaults to `true`; only `false` when the link helper
    # explicitly passed `backdrop: false` (carried in the
    # `X-Turbo-Overlay-Backdrop` header). Drawer partials switch the
    # `<dialog>` open mode and CSS based on this.
    def turbo_overlay_backdrop?
      return @_turbo_overlay_backdrop if defined?(@_turbo_overlay_backdrop)
      @_turbo_overlay_backdrop = _resolve_overlay_backdrop
    end

    # Whether the current overlay request should render the chrome's
    # default close ("×") button. Defaults to `true`; only `false`
    # when the link helper explicitly passed `close_button: false`
    # (carried in the `X-Turbo-Overlay-Close` header). Chrome partials
    # consult `overlay_close?` (view helper) which folds this into the
    # full opt-out precedence chain.
    def turbo_overlay_close?
      return @_turbo_overlay_close if defined?(@_turbo_overlay_close)
      @_turbo_overlay_close = _resolve_overlay_close
    end

    # True for the initial open of an overlay (an `X-Turbo-Overlay`
    # request that is not a form re-render inside an existing
    # overlay frame). Used internally to decide between turbo-stream
    # append wrapping and turbo-frame replace wrapping.
    def turbo_overlay_initial_open?
      return false unless turbo_overlay_type
      !turbo_overlay_frame_re_render?
    end

    # True when this is a form/link response targeting an existing
    # overlay's turbo-frame (form re-render in place).
    def turbo_overlay_frame_re_render?
      return false unless respond_to?(:request) && request
      request.headers["Turbo-Frame"].to_s.start_with?(OVERLAY_FRAME_PREFIX)
    end

    private

    def _resolve_overlay_type
      return nil unless respond_to?(:request) && request

      header = request.headers[OVERLAY_TYPE_HEADER].to_s.downcase
      return :modal   if header == "modal"
      return :drawer  if header == "drawer"
      return :popover if header == "popover"
      return :hint    if header == "hint"

      frame = request.headers["Turbo-Frame"].to_s
      if frame.start_with?(OVERLAY_FRAME_PREFIX)
        rest = frame[OVERLAY_FRAME_PREFIX.length..]
        return :modal   if rest.start_with?("modal_")
        return :drawer  if rest.start_with?("drawer_")
        return :popover if rest.start_with?("popover_")
      end

      nil
    end

    def _resolve_overlay_id
      return nil unless turbo_overlay_type

      supplied = request.headers[OVERLAY_ID_HEADER].to_s
      return supplied unless supplied.empty?

      frame = request.headers["Turbo-Frame"].to_s
      if frame.start_with?(OVERLAY_FRAME_PREFIX)
        rest = frame[OVERLAY_FRAME_PREFIX.length..]
        underscore = rest.index("_")
        return rest[(underscore + 1)..] if underscore
      end

      SecureRandom.alphanumeric(8)
    end

    def _resolve_overlay_position
      return nil unless respond_to?(:request) && request

      value = request.headers[OVERLAY_POSITION_HEADER].to_s
      return nil if value.empty?
      value.to_sym
    end

    def _resolve_overlay_align
      return nil unless respond_to?(:request) && request

      value = request.headers[OVERLAY_ALIGN_HEADER].to_s
      return nil if value.empty?
      value.to_sym
    end

    def _resolve_overlay_offset
      return nil unless respond_to?(:request) && request

      value = request.headers[OVERLAY_OFFSET_HEADER].to_s
      return nil if value.empty?
      Integer(value, exception: false)
    end

    def _resolve_overlay_backdrop
      return true unless respond_to?(:request) && request
      request.headers[OVERLAY_BACKDROP_HEADER].to_s != "false"
    end

    def _resolve_overlay_close
      return true unless respond_to?(:request) && request
      request.headers[OVERLAY_CLOSE_HEADER].to_s != "false"
    end

    def _turbo_overlay_set_variant
      type = turbo_overlay_type
      return unless type

      variant = TurboOverlay.configuration.public_send(type).variant
      if request.variant.is_a?(Array)
        request.variant << variant unless request.variant.include?(variant)
      else
        request.variant = variant
      end
    end

    # Initial overlay opens are GET requests with Accept including
    # `text/vnd.turbo-stream.html`. Force html format so Rails
    # resolves `*.html.erb` templates normally (no need for the user
    # to provide `*.turbo_stream.erb` variants); we override the
    # response Content-Type after the action so Turbo still processes
    # the embedded `<turbo-stream>` tags.
    #
    # Hint requests skip both: they're fetched by the gem's JS via
    # plain `fetch()` (not Turbo), the Accept header is `text/html`
    # already, and the response is parsed via DOMParser. Forcing the
    # turbo-stream content type would make Turbo try to process the
    # response if it ever did intercept it.
    def _turbo_overlay_force_html_format
      return unless turbo_overlay_initial_open?
      return if turbo_overlay_type == :hint
      request.format = :html
    end

    def _turbo_overlay_set_stream_content_type
      return unless turbo_overlay_initial_open?
      return if turbo_overlay_type == :hint
      return unless response
      response.content_type = "text/vnd.turbo-stream.html; charset=utf-8"
    end
  end
end
