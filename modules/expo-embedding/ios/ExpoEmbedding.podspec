Pod::Spec.new do |s|
  s.name           = "ExpoEmbedding"
  s.version        = "0.0.1"
  s.summary        = "Local Expo module providing image embeddings"
  s.description    = "Local Expo module providing image embeddings"
  s.license        = { :type => "MIT" }
  s.author         = { "you" => "you@example.com" }
  s.homepage       = "https://example.com"
  s.platform       = :ios, "15.1"
  s.source         = { :path => "." }

  s.static_framework = true
  s.requires_arc     = true

  s.dependency "ExpoModulesCore"

  s.source_files = "**/*.{h,m,mm,swift}"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_VERSION" => "5.0"
  }
end