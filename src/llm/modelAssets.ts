import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";

async function ensureAssetFile(moduleId: number, filename: string) {
    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();

    const outPath = `${FileSystem.cacheDirectory}${filename}`;
    const info = await FileSystem.getInfoAsync(outPath);

    if (!info.exists) {
        await FileSystem.copyAsync({ from: asset.localUri!, to: outPath });
    }
    return outPath;
}

// Call this once at startup / before loading model
export async function getLLMPaths() {
    const modelPath = await ensureAssetFile(
        require("../../local-llm/fine-tuning/fine_tuned_qwen3_06b.pte"),
        "qwen3_0_6b.pte"
    );
    const tokenizerPath = await ensureAssetFile(
        require("../../local-llm/fine-tuning/tokenizer.json"),
        "tokenizer.json"
    );
    const tokenizerConfigPath = await ensureAssetFile(
        require("../../local-llm/fine-tuning/tokenizer_config.json"),
        "tokenizer_config.json"
    );

    return { modelPath, tokenizerPath, tokenizerConfigPath };
}