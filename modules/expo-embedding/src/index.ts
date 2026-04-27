import { requireOptionalNativeModule } from "expo-modules-core";

export type EmbeddingModuleType = {
    embedImageBase64(base64: string): Promise<number[]>;
};

export const EmbeddingModule =
    requireOptionalNativeModule<EmbeddingModuleType>("EmbeddingModule");