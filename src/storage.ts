import AsyncStorage from "@react-native-async-storage/async-storage";

export type Sample = {
    z: number[];      // embedding as JS array (store-friendly)
    y: number[];      // length 17 (0/1)
    t: number;        // timestamp
};

const KEY = "solidfl.samples.v1";

export async function loadSamples(): Promise<Sample[]> {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return [];
    try { return JSON.parse(s) as Sample[]; } catch { return []; }
}

export async function addSample(sample: Sample) {
    const all = await loadSamples();
    all.push(sample);
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

export async function clearSamples() {
    await AsyncStorage.removeItem(KEY);
}