import ExpoModulesCore

public class ExpoLLMModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLLMModule")

    AsyncFunction("generate") { (instruction: String) async throws -> [String: Any] in
      let lower = instruction.lowercased()
      let wantsToday = lower.contains("today")
      let wantsYesterday = lower.contains("yesterday")
      let wantsLastWeek = lower.contains("last week") || lower.contains("lastweek")
      let wantsNoKids = lower.contains("children") || lower.contains("kids")
      let wantsNoPII = lower.contains("pii") || lower.contains("address") || lower.contains("plate")
      let wantsNoScreenshots = lower.contains("screenshot")
      let wantsDownsize = !lower.contains("original")

      var query = "recent photos"
      if wantsToday { query = "photos from today" }
      else if wantsYesterday { query = "photos from yesterday" }
      else if wantsLastWeek { query = "photos from last week" }

      var filters: [String: Any] = [
        "downsize": wantsDownsize,
        "strip_metadata": true,
        "exclude_nudity": true,
        "exclude_screenshots": true,
        "dedupe": true
      ]
      if wantsNoKids { filters["exclude_children"] = true }
      if wantsNoPII { filters["exclude_pii"] = ["plates": true, "addresses": true] }

      let action: [String: Any] = [
        "query": query,
        "filters": filters,
        "require_confirm": true,
        "upload_path": "pod:/pictures/uploads/"
      ]

      let assistantText =
"""
I can do that. Before uploading: which pod path should I use? Upload originals or downsized? Ok to include faces/metadata?
"""

      return [
        "assistant_text": assistantText,
        "action": action
      ]
    }
  }
}