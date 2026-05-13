ENV["RAILS_ENV"] ||= "test"

require_relative "dummy/config/environment"
require "rails/test_help"
require "capybara/cuprite"

Capybara.register_driver(:cuprite) do |app|
  Capybara::Cuprite::Driver.new(
    app,
    window_size:    [1280, 800],
    headless:       "new",
    process_timeout: 30,
    timeout:        20,
    js_errors:      true
  )
end

Capybara.default_driver           = :cuprite
Capybara.javascript_driver        = :cuprite
Capybara.default_max_wait_time    = 5
Capybara.server                   = :puma, { Silent: true }

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  driven_by :cuprite
end
