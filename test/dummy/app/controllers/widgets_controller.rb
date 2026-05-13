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
end
