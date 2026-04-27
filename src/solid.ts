// src/solid.ts
import { float32ToNpyBytes } from "./npy";
import { flowerDetector } from "./flowerDetector";
import * as MediaLibrary from "expo-media-library";
import * as ImageManipulator from "expo-image-manipulator";
// ✅ correct for SDK 50+
import * as FileSystem from "expo-file-system/legacy";

// Put your POD_BASE here (or pass it in)
const POD_BASE = "https://pods.solidcommunity.au/TestPod1/";

function now() {
    return new Date().toISOString().replace("T", " ").replace("Z", "");
}

export async function putNpy(url: string, accessToken: string, arr: Float32Array) {
    const bytes = float32ToNpyBytes(arr);
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/octet-stream",
        },
        body: bytes as any,
    });
    const txt = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`PUT npy failed: ${res.status} ${res.statusText}\n${txt}`);
}

// src/solid.ts

export async function putFile(
    url: string,
    accessToken: string,
    fileUri: string,
    contentType = "application/octet-stream"
) {
    const res = await FileSystem.uploadAsync(url, fileUri, {
        httpMethod: "PUT",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": contentType,
        },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    });

    if (res.status < 200 || res.status >= 300) {
        throw new Error(
            `PUT file failed: ${res.status}\n${res.body ?? ""}`
        );
    }
}
export async function putText(
    url: string,
    accessToken: string,
    body: string,
    contentType = "text/plain"
) {
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": contentType,
        },
        body,
    });

    const txt = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`PUT failed: ${res.status} ${res.statusText}\n${txt}`);
}

export async function putBlob(
    url: string,
    accessToken: string,
    body: Blob,
    contentType = "application/octet-stream"
) {
    let res: Response | null = null;
    try {
        res = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": contentType,
            },
            body,
        });
    } catch (e: any) {
        // This is the "Network request failed" class of errors (no HTTP response)
        throw new Error(
            `PUT fetch threw before response. url=${url} err=${e?.name ?? "?"}: ${e?.message ?? String(e)}`
        );
    }

    const txt = await res.text().catch(() => "(no body)");
    if (!res.ok) {
        throw new Error(
            `PUT failed: ${res.status} ${res.statusText}\nurl=${url}\nbody=${txt}`
        );
    }
    return { status: res.status, body: txt };
}

export async function scanAndUploadFlowers(params: {
    accessToken: string;
    addLog: (s: string) => void;
    maxToScan?: number;     // recent photos to check
    maxToUpload?: number;   // flower hits to upload
}) {
    const { accessToken, addLog, maxToScan = 50, maxToUpload = 10 } = params;

    addLog(`[${now()}] 📷 requesting media library permission...`);
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) {
        addLog(`[${now()}] ❌ media library permission denied`);
        return;
    }

    addLog(`[${now()}] listing recent images (max ${maxToScan})...`);
    const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [MediaLibrary.SortBy.creationTime],
        first: maxToScan,
    });

    addLog(`[${now()}] found ${page.assets.length} assets`);

    // Warmup classifier on the newest image if possible (speeds first “real” inference)
    if (page.assets[0]) {
        const info0 = await MediaLibrary.getAssetInfoAsync(page.assets[0]);
        const uri0 = info0.localUri ?? info0.uri;
        if (uri0) {
            addLog(`[${now()}] warming up classifier...`);
            try {
                const small0 = await ImageManipulator.manipulateAsync(
                    uri0,
                    [{ resize: { width: 224 } }],
                    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
                );
                await flowerDetector.warmup(small0.uri);
                addLog(`[${now()}] ✅ warmup done`);
            } catch (e: any) {
                addLog(`[${now()}] ⚠️ warmup failed (continuing): ${e?.message ?? String(e)}`);
            }
        }
    }

    let uploaded = 0;

    for (let idx = 0; idx < page.assets.length; idx++) {
        if (uploaded >= maxToUpload) break;

        const a = page.assets[idx];
        const info = await MediaLibrary.getAssetInfoAsync(a);
        const uri = info.localUri ?? info.uri;
        if (!uri) continue;

        // Downsize for classification
        const small = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 224 } }],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );

        let isFlower = false;
        try {
            isFlower = await flowerDetector.isFlowerImage(small.uri);
        } catch (e: any) {
            addLog(`[${now()}] ⚠️ classify failed on asset ${a.id}: ${e?.message ?? String(e)}`);
            continue;
        }

        if (!isFlower) continue;

        // Re-encode for upload: resize + JPEG strip metadata (practically)
        const uploadJpg = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 1024 } }],
            { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
        );

        const blob = await (await fetch(uploadJpg.uri)).blob();
        const filename = `flower_${Date.now()}_${a.id}.jpg`;
        const uploadUrl = `${POD_BASE}shared/${filename}`;

        addLog(`[${now()}] 🌸 uploading ${filename} -> shared/`);
        await putBlob(uploadUrl, accessToken, blob, "image/jpeg");

        uploaded++;
        addLog(`[${now()}] ✅ uploaded (${uploaded}/${maxToUpload})`);
    }

    addLog(`[${now()}] done. uploaded=${uploaded}`);
}