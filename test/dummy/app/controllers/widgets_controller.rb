class WidgetsController < ApplicationController
  WIDGETS = {
    "1" => { name: "Sprocket",  description: "A small toothed wheel." },
    "2" => { name: "Flywheel",  description: "A heavy spinning disc."  },
    "3" => { name: "Bearing",   description: "Spins smoothly."         }
  }.freeze

  def index
    @widgets = WIDGETS
  end

  def show
    @widget = WIDGETS.fetch(params[:id])
  end

  # Renders a turbo_stream that closes the current overlay. Drives the
  # "server-issued close" system test — exercises the full pipeline:
  # POST → turbo_stream.overlay(:close, id:) → JS stream action →
  # turbo-overlay:close event → stack controller routes → overlay
  # controller close().
  def close
    render turbo_stream: turbo_stream.overlay(:close, id: turbo_overlay_id)
  end
end
