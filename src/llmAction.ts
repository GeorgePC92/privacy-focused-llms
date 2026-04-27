export type LLMAction = {
    query: string;
    filters: {
        downsize?: boolean;
        strip_metadata?: boolean;
        exclude_children?: boolean;
        exclude_nudity?: boolean;
        exclude_screenshots?: boolean;
        dedupe?: boolean;
        exclude_pii?: { plates?: boolean; addresses?: boolean };
        allow_faces?: boolean;
    };
    require_confirm: boolean;
    upload_path: string;
};

// Extracts the last JSON object in the assistant text.
export function extractAction(text: string): { action: LLMAction | null; error?: string } {
    const lastBrace = text.lastIndexOf("{");
    const lastClose = text.lastIndexOf("}");
    if (lastBrace < 0 || lastClose < 0 || lastClose <= lastBrace) {
        return { action: null, error: "No JSON object found in assistant output." };
    }
    const jsonStr = text.slice(lastBrace, lastClose + 1);
    try {
        const parsed = JSON.parse(jsonStr) as LLMAction;
        return { action: parsed };
    } catch (e: any) {
        return { action: null, error: `Failed to parse JSON action: ${e?.message ?? String(e)}` };
    }
}