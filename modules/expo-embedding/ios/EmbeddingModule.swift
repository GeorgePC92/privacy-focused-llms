import ExpoModulesCore

public class EmbeddingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EmbeddingModule")

    AsyncFunction("embedImageBase64") { (base64: String) async throws -> [Double] in
      _ = Data(base64Encoded: base64)
      return Array(repeating: 0.0, count: 256)
    }
  }
}