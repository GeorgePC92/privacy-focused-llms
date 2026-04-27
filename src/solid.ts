import { float32ToNpyBytes } from "./npy";


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

export async function putText(url: string, accessToken: string, body: string, contentType = "text/plain") {
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


