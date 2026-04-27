// src/llmAction.ts

type SelectedIdsAction = {
    selected_asset_ids: string[];
};
export type UploadAction = {
    query: string;
    filters: Record<string, any>;
    require_confirm: boolean;
    upload_path: "shared/";
    selected_asset_ids: string[];
};

export type LLMAction = {
    query: string;
    filters: Record<string, any>;

    // Whether the app must ask user confirmation before upload
    require_confirm: boolean;

    // MUST always be "shared/"
    upload_path: "shared/";

    // Asset IDs selected from the scan
    selected_asset_ids: string[];
};