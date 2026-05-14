class WidgetsController < ApplicationController
  WIDGETS = {
    "1" => { name: "Sprocket",  description: "A small toothed wheel." },
    "2" => { name: "Flywheel",  description: "A heavy spinning disc."  },
    "3" => { name: "Bearing",   description: "Spins smoothly."         }
  }.freeze

  # Process-local counter that increments on every `bump` action.
  # Drives the smooth same-page redirect system test: the form in
  # the overlay POSTs to `bump`, which redirects to widgets index.
  # The morph-behind path should update the counter in the host
  # page's DOM before the overlay closes.
  @@bump_counter = 0
  def self.reset_bump_counter
    @@bump_counter = 0
  end

  def index
    @widgets = WIDGETS
    @bump_counter = @@bump_counter
  end

  def show
    @widget = WIDGETS.fetch(params[:id])
  end

  # `new` + `create` drive the form-re-render system test. `create`
  # always re-renders the form with an error so the test can assert
  # the overlay stays open with the error visible — exercising the
  # `turbo_overlay_frame_re_render?` path in `overlay_response_wrapper`.
  def new
    @widget_form = { name: "" }
    @error = nil
  end

  def create
    if params.dig(:widget, :name).to_s.strip.empty?
      @widget_form = { name: "" }
      @error = "Name is required"
      render :new, status: :unprocessable_entity
    else
      # Mirrors the realistic pattern: `respond_to` with a
      # `format.turbo_stream` success branch and a `format.html`
      # redirect fallback. Drives the regression test for the
      # format-forcing bug — if the concern ever forced format to
      # :html on a frame re-render, the redirect branch would run
      # and Turbo would follow it back through the overlay layout,
      # morphing the next page into the open dialog.
      respond_to do |format|
        format.turbo_stream do
          render turbo_stream: turbo_stream.overlay(:close, id: turbo_overlay_id)
        end
        format.html { redirect_to widgets_path, notice: "Created" }
      end
    end
  end

  def destroy
    render turbo_stream: turbo_stream.overlay(:close, id: turbo_overlay_id)
  end

  # Renders a turbo_stream that closes the current overlay. Drives the
  # "server-issued close" system test — exercises the full pipeline:
  # POST → turbo_stream.overlay(:close, id:) → JS stream action →
  # turbo-overlay:close event → stack controller routes → overlay
  # controller close().
  def close
    render turbo_stream: turbo_stream.overlay(:close, id: turbo_overlay_id)
  end

  # Renders a form whose submit drives the smooth-redirect system
  # tests. Form posts to `bump`, which performs a plain HTTP redirect
  # to the index — the path the morph-and-close handler exercises.
  def bump_form
  end

  # Plain HTTP redirect after mutating server state. Drives the
  # smooth same-page redirect path — the overlay controller's
  # submit-end handler should see `fetchResponse.redirected = true`
  # with the index URL, recognize it as same-pathname as the page
  # the overlay was opened from, fetch the index, morph the host
  # page (showing the incremented counter), then animate close.
  def bump
    @@bump_counter += 1
    redirect_to widgets_path
  end
end
