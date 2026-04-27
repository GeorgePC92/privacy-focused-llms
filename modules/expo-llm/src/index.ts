import { requireOptionalNativeModule } from "expo-modules-core";

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
    };
    require_confirm: boolean;
    upload_path: string;
};

export type LLMGenerateResult = {
    assistant_text: string;
    action: LLMAction;
};

type ExpoLLMModuleType = {
    generate(instruction: string): Promise<LLMGenerateResult>;
};

export const ExpoLLMModule =
    requireOptionalNativeModule<ExpoLLMModuleType>("ExpoLLMModule");