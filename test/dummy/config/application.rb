require_relative "boot"

require "rails"
require "active_support/railtie"
require "action_controller/railtie"
require "action_view/railtie"
require "propshaft"
require "turbo-rails"
require "stimulus-rails"
require "importmap-rails"

Bundler.require(*Rails.groups)

require "turbo_overlay"

module Dummy
  class Application < Rails::Application
    # The gem's Gemfile/Rakefile sit one level up, so Rails' default
    # root-finder (which walks up from application.rb looking for a
    # Gemfile/Rakefile) would pick the gem root instead of test/dummy.
    # Pinning the dummy's root keeps routes.rb / app/views / etc. in
    # the expected places.
    config.root = File.expand_path("..", __dir__)

    config.load_defaults Rails::VERSION::STRING.to_f

    config.eager_load = false
    config.secret_key_base = "x" * 64
    config.consider_all_requests_local = true
    config.action_controller.allow_forgery_protection = false
    config.hosts.clear
    config.logger = Logger.new(IO::NULL)
    config.active_support.deprecation = :silence

    # No ActiveRecord, ActiveJob, ActionMailer, etc. — pure routing
    # + views, just enough to exercise the gem in a browser.
  end
end
