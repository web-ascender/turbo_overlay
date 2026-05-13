require "bundler/gem_tasks"
require "rake/testtask"

Rake::TestTask.new(:test) do |t|
  t.libs << "test"
  t.libs << "lib"
  # Unit tests only — system tests bootstrap a Rails app and run
  # under a separate `rake test:system` task so the dummy app doesn't
  # have to load for every unit-test run.
  t.test_files = FileList["test/**/*_test.rb"].exclude("test/system/**/*")
  t.warning = false
end

namespace :test do
  Rake::TestTask.new(:system) do |t|
    t.libs << "test"
    t.libs << "lib"
    t.test_files = FileList["test/system/**/*_test.rb"]
    t.warning = false
  end
end

namespace :dummy do
  desc "Boot the test/dummy Rails app on localhost so you can poke at it in a real browser (PORT=4001 by default)"
  task :serve do
    ENV["RAILS_ENV"] = "test"   # only env the dummy has configured
    require_relative "test/dummy/config/environment"
    require "rack/handler/puma"
    port = ENV.fetch("PORT", "4001").to_i
    puts "→ Dummy app on http://localhost:#{port}  (Ctrl-C to stop)"
    Rack::Handler::Puma.run(Rails.application, Port: port, Silent: true)
  end
end

task default: :test
