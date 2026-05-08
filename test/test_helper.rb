$LOAD_PATH.unshift File.expand_path("../lib", __dir__)

require "minitest/autorun"
require "active_support"
require "active_support/core_ext/string/output_safety"
require "turbo_overlay/version"
require "turbo_overlay/configuration"
require "turbo_overlay"
