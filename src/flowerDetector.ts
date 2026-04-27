// src/flowerDetector.ts
import { ClassificationModule, EFFICIENTNET_V2_S } from "react-native-executorch";

export type FlowerDetector = {
    warmup: (anyImageUri?: string) => Promise<void>;
    isFlowerImage: (uri: string) => Promise<boolean>;
};

// Keywords that commonly appear in ImageNet label strings
const FLOWER_KEYWORDS = [
    "flower",
    "daisy",
    "sunflower",
    "tulip",
    "rose",
    "orchid",
    "lily",
    "lotus",
    "poppy",
    "hibiscus",
    "magnolia",
    "bouquet",
];

function topK(obj: Record<string, number>, k = 5) {
    return Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, k)
        .map(([label, p]) => ({ label, p }));
}

let _module: ClassificationModule | null = null;
let _loaded = false;
let _loading: Promise<void> | null = null;

async function getModule() {
    if (_module && _loaded) return _module;

    if (!_loading) {
        _loading = (async () => {
            _module = new ClassificationModule();
            // Loads a bundled “resource descriptor” that the lib can fetch/cache.
            // No local .pte required for this path.
            await _module.load(EFFICIENTNET_V2_S);
            _loaded = true;
        })().finally(() => {
            _loading = null;
        });
    }

    await _loading;
    return _module!;
}

export const flowerDetector: FlowerDetector = {
    warmup: async (anyImageUri?: string) => {
        const mod = await getModule();
        if (anyImageUri) {
            // One forward pass forces full init / shader / caches etc.
            await mod.forward(anyImageUri);
        }
    },

    isFlowerImage: async (uri: string) => {
        const mod = await getModule();
        const probs = await mod.forward(uri); // { [category: string]: number }  [oai_citation:1‡docs.swmansion.com](https://docs.swmansion.com/react-native-executorch/docs/typescript-api/computer-vision/ClassificationModule)

        const top = topK(probs, 8);

        // Simple rule:
        // - if any top label contains a flower keyword AND prob is decent => flower
        for (const t of top) {
            const s = t.label.toLowerCase();
            if (t.p >= 0.12 && FLOWER_KEYWORDS.some((kw) => s.includes(kw))) return true;
        }
        return false;
    },
};