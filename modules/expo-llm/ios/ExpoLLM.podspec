Pod::Spec.new do |s|
  s.name         = "ExpoLLM"
  s.version      = "0.0.1"
  s.summary      = "Expo LLM module (local native module for dev client)"
  s.description  = "Local Expo Module providing an LLM bridge. Stub implementation initially."
  s.homepage     = "https://example.local/expo-llm"
  s.license      = { :type => "MIT" }
  s.authors      = { "SolidFL" => "dev@example.local" }

  s.platforms    = { :ios => "15.1" }

  # CocoaPods wants a primary source key; for local pods, a dummy http is fine.
  s.source       = { :http => "https://example.local/expo-llm-0.0.1.tar.gz" }

  s.source_files = "**/*.{h,m,mm,swift}"
  s.dependency   "ExpoModulesCore"
  s.swift_version = "5.9"
end