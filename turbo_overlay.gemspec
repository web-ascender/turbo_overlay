require_relative "lib/turbo_overlay/version"

Gem::Specification.new do |spec|
  spec.name        = "turbo_overlay"
  spec.version     = TurboOverlay::VERSION
  spec.authors     = ["Joel Schneider"]
  spec.email       = ["joel.schneider@webascender.com"]

  spec.summary     = "Render any Rails view inside a modal or drawer using Turbo Frames."
  spec.description = <<~DESC
    Turbo Overlay turns any controller action into a modal-friendly endpoint.
    A single Turbo Frame on the host page captures overlay-bound links;
    the gem detects those requests, swaps in an overlay layout, exposes a
    request variant for view-level customization, and ships a custom
    turbo-stream action plus Stimulus controller for closing the overlay
    on success. Themes for Tailwind, Bootstrap 5, Bootstrap 3, and plain
    CSS are installable via generator.
  DESC
  spec.homepage    = "https://github.com/jmschneider/turbo_overlay"
  spec.license     = "MIT"
  spec.required_ruby_version = ">= 3.0"

  spec.metadata["homepage_uri"]    = spec.homepage
  spec.metadata["source_code_uri"] = spec.homepage
  spec.metadata["changelog_uri"]   = "#{spec.homepage}/blob/main/CHANGELOG.md"

  spec.files = Dir[
    "{app,config,lib}/**/*",
    "MIT-LICENSE",
    "LICENSE.txt",
    "Rakefile",
    "README.md",
    "CHANGELOG.md"
  ].select { |f| File.file?(f) }

  spec.add_dependency "rails", ">= 6.1"
  spec.add_dependency "turbo-rails", ">= 1.0"

  spec.add_development_dependency "minitest", ">= 5.0"
  spec.add_development_dependency "rake", ">= 13.0"
end
