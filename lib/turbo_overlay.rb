require "turbo_overlay/version"
require "turbo_overlay/configuration"
require "turbo_overlay/styles"

module TurboOverlay
  class << self
    def configuration
      @configuration ||= Configuration.new
    end

    def configure
      yield configuration
    end

    def reset_configuration!
      @configuration = Configuration.new
    end
  end
end

require "turbo_overlay/engine" if defined?(Rails::Engine)
