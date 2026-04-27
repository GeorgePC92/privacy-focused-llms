// App.tsx
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
    Button,
    SafeAreaView,
    ScrollView,
    Text,
    TextInput,
    View,
    Alert,
} from "react-native";

import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";

import * as MediaLibrary from "expo-media-library";
import * as ImageManipulator from "expo-image-manipulator";

import { useLLM, type Message } from "react-native-executorch";
import { flowerDetector } from "./src/flowerDetector";

import { putBlob, putText, putFile } from "./src/solid";
import { LLMAction, UploadAction } from "./src/llmAction";

WebBrowser.maybeCompleteAuthSession();

// Hardcode endpoints (NO discovery)
const AUTH_ENDPOINT = "https://pods.solidcommunity.au/.oidc/auth";
const TOKEN_ENDPOINT = "https://pods.solidcommunity.au/.oidc/token";
const REG_ENDPOINT = "https://pods.solidcommunity.au/.oidc/reg";


// Solid upload target
const POD_BASE = "https://pods.solidcommunity.au/TestPod1/"; // keep trailing slash

// ===== helpers =====
function now() {
    return new Date().toISOString().replace("T", " ").replace("Z", "");
}
function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function canonicalAssetId(id: string) {
    // iOS sometimes gives "UUID/L0/001" from localUri-style strings
    // Expo MediaLibrary Asset.id is usually just the UUID
    return (id || "").split("/")[0].trim();
}

function base64UrlFromBytes(bytes: Uint8Array) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    // @ts-ignore
    const b64 = globalThis.btoa(s);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256Base64Url(input: string) {
    const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        input,
        { encoding: Crypto.CryptoEncoding.BASE64 }
    );
    return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function parseQueryParams(url: string): Record<string, string> {
    const q = url.split("?")[1] ?? "";
    const parts = q.split("&").filter(Boolean);
    const out: Record<string, string> = {};
    for (const p of parts) {
        const [k, v] = p.split("=");
        out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
    return out;
}


function diagnoseNetworkError(e: any, ctx: {
    step: string;
    url?: string;
    token?: string;
    blob?: Blob | null;
    uri?: string;
}) {
    const tokenLen = ctx.token ? ctx.token.length : 0;

    const hints: string[] = [];
    if (ctx.url && /\/shared\/.*\/L\d+\/\d+/.test(ctx.url)) {
        hints.push("URL contains '/L0/001' style segments -> likely unsanitized asset id in filename");
    }
    if (ctx.url && ctx.url.includes(" ")) hints.push("URL contains spaces -> must encode/sanitize filename");
    if (ctx.url && !ctx.url.startsWith("https://")) hints.push("URL is not https://");
    if (!ctx.token) hints.push("No access token set");
    if (ctx.token && tokenLen < 20) hints.push(`Token looks too short (len=${tokenLen})`);
    if (ctx.blob && typeof (ctx.blob as any).size === "number" && (ctx.blob as any).size === 0) {
        hints.push("Blob size is 0 -> image read/convert failed");
    }
    if (ctx.uri && ctx.uri.startsWith("ph://")) {
        hints.push("URI is ph:// (iOS Photos) -> sometimes fetch(uri).blob() fails; prefer FileSystem.uploadAsync");
    }

    const extra = [
        `step=${ctx.step}`,
        ctx.url ? `url=${ctx.url}` : "",
        ctx.uri ? `uri=${ctx.uri}` : "",
        `token.len=${tokenLen}`,
        ctx.blob ? `blob.type=${(ctx.blob as any).type || "?"} blob.size=${(ctx.blob as any).size ?? "?"}` : "blob=(none)",
        `err.name=${e?.name ?? "(none)"}`,
        `err.message=${e?.message ?? "(none)"}`,
    ].filter(Boolean).join(" | ");

    return { extra, hints };
}

function toErrString(e: unknown) {
    if (e == null) return "(none)";
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message;
    // @ts-ignore
    if (typeof e?.message === "string") return e.message;
    try {
        return JSON.stringify(e);
    } catch {
        return String(e);
    }
}
function extractFirstJsonObject(text: string) {
    const start = text.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inStr = false;
    let esc = false;

    for (let i = start; i < text.length; i++) {
        const c = text[i];

        if (inStr) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === '"') inStr = false;
            continue;
        } else {
            if (c === '"') { inStr = true; continue; }
            if (c === "{") depth++;
            if (c === "}") depth--;
            if (depth === 0) {
                const candidate = text.slice(start, i + 1).trim();
                try { return JSON.parse(candidate); } catch { return null; }
            }
        }
    }
    return null;
}

function extractJsonArrayAnywhere(text: string): string[] | null {
    const start = text.indexOf("[");
    if (start === -1) return null;

    let depth = 0;
    let inStr = false;
    let esc = false;

    for (let i = start; i < text.length; i++) {
        const c = text[i];

        if (inStr) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === '"') inStr = false;
            continue;
        } else {
            if (c === '"') { inStr = true; continue; }
            if (c === "[") depth++;
            if (c === "]") depth--;

            if (depth === 0) {
                const candidate = text.slice(start, i + 1).trim();
                try {
                    const parsed = JSON.parse(candidate);
                    if (!Array.isArray(parsed)) return null;

                    // normalize to string[]
                    const out = parsed
                        .filter((x) => typeof x === "string")
                        .map((x) => x.trim())
                        .filter((x) => x.length > 0);

                    return out.length ? out : [];
                } catch {
                    return null;
                }
            }
        }
    }

    return null;
}

// IMPORTANT: sanitize anything that ends up in a URL path segment
function safeIdForFilename(id: string) {
    // turns "CC95.../L0/001" into "CC95..._L0_001"
    return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ===== LLM model assets (BUNDLED) =====
const LOCAL_LLM_MODEL = {
    modelSource: require("./local-llm/fine-tuning/fine_tuned_qwen3_06b.pte"),
    tokenizerSource: require("./local-llm/fine-tuning/tokenizer.tok"),
    tokenizerConfigSource: require("./local-llm/fine-tuning/tokenizer_config.tokcfg"),
};

type FlowerCandidate = {
    assetId: string;
    uri: string; // original local uri for upload
    suggestedName: string;
};



export default function App() {
    const [log, setLog] = useState("");
    const addLog = useCallback((line: string) => {
        setLog((p) => (p ? p + "\n" : "") + line);
    }, []);
    const clear = useCallback(() => setLog(""), []);

    const [accessToken, setAccessToken] = useState("");
    const [clientId, setClientId] = useState("");

    const [instruction, setInstruction] = useState(
        "Upload pictures of flowers from my recent camera roll."
    );

    const [scanSummary, setScanSummary] = useState<string>("");
    const [candidates, setCandidates] = useState<FlowerCandidate[]>([]);

    const [assistantText, setAssistantText] = useState("");
    const [pendingAction, setPendingAction] = useState<UploadAction | null>(null);

    const [busy, setBusy] = useState(false);
    const lastUploadKeyRef = useRef<string>("");

    const redirectUri = useMemo(() => {
        return AuthSession.makeRedirectUri({ scheme: "com.anonymous.solidfl", path: "auth" });
    }, []);

    // ---- auth helpers ----
    async function fetchWithDebug(url: string, init?: RequestInit, timeoutMs = 20000) {
        const method = init?.method ?? "GET";
        addLog(`[${now()}] fetch ${method} ${url}`);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...init, signal: ctrl.signal });
            addLog(`[${now()}] -> ${res.status} ${res.statusText}`);
            return res;
        } finally {
            clearTimeout(t);
        }
    }

    async function dynamicRegister(redirectUriStr: string): Promise<string> {
        const body = {
            client_name: "SolidFL Mobile (Expo Dev Build)",
            application_type: "native",
            redirect_uris: [redirectUriStr],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
        };

        let lastErr: any = null;
        for (let attempt = 1; attempt <= 6; attempt++) {
            try {
                addLog(`[${now()}] reg attempt ${attempt}/6`);
                const res = await fetchWithDebug(REG_ENDPOINT, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify(body),
                });
                const txt = await res.text().catch(() => "");
                if (!res.ok) throw new Error(`client reg failed: ${res.status} ${res.statusText}\n${txt}`);
                const j = JSON.parse(txt);
                if (!j.client_id) throw new Error("client reg response missing client_id");
                return j.client_id as string;
            } catch (e: any) {
                lastErr = e;
                const backoff = 600 * attempt + Math.floor(Math.random() * 300);
                addLog(`[${now()}] reg failed: ${e?.message ?? String(e)}`);
                addLog(`[${now()}] retrying in ${backoff}ms...`);
                await sleep(backoff);
            }
        }
        throw lastErr ?? new Error("dynamic register failed");
    }

    async function exchangeToken(params: {
        code: string;
        codeVerifier: string;
        clientId: string;
        redirectUri: string;
    }) {
        const body = new URLSearchParams();
        body.set("grant_type", "authorization_code");
        body.set("code", params.code);
        body.set("redirect_uri", params.redirectUri);
        body.set("client_id", params.clientId);
        body.set("code_verifier", params.codeVerifier);

        const res = await fetchWithDebug(TOKEN_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: body.toString(),
        });

        const txt = await res.text().catch(() => "");
        if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${res.statusText}\n${txt}`);
        return JSON.parse(txt) as { access_token: string; token_type: string; expires_in?: number };
    }

    const login = useCallback(async () => {
        clear();
        setAccessToken("");
        setClientId("");
        try {
            addLog(`[${now()}] redirectUri: ${redirectUri}`);

            // PKCE
            let codeVerifier = "";
            for (let tries = 0; tries < 5; tries++) {
                const bytes = await Crypto.getRandomBytesAsync(64);
                codeVerifier = base64UrlFromBytes(bytes);
                if (codeVerifier.length >= 43) break;
            }
            const codeChallenge = await sha256Base64Url(codeVerifier);

            const newClientId = await dynamicRegister(redirectUri);
            setClientId(newClientId);
            addLog(`[${now()}] client_id: ${newClientId}`);

            const authUrl =
                `${AUTH_ENDPOINT}?response_type=code` +
                `&client_id=${encodeURIComponent(newClientId)}` +
                `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                `&scope=${encodeURIComponent("openid profile webid offline_access")}` +
                `&code_challenge=${encodeURIComponent(codeChallenge)}` +
                `&code_challenge_method=S256`;

            addLog(`[${now()}] opening login...`);
            const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
            addLog(`[${now()}] openAuthSessionAsync result: ${JSON.stringify(result)}`);

            if (result.type !== "success" || !result.url) {
                addLog(`[${now()}] auth ended: type=${result.type}`);
                return;
            }

            const qp = parseQueryParams(result.url);
            const code = qp.code;
            if (!code) throw new Error(`missing code in redirect: ${result.url}`);

            const tok = await exchangeToken({
                code,
                codeVerifier,
                clientId: newClientId,
                redirectUri,
            });

            setAccessToken(tok.access_token);
            addLog(`[${now()}] ✅ token ok (${tok.token_type}, expires=${tok.expires_in ?? "?"}s)`);
        } catch (e: any) {
            addLog(`[${now()}] ❌ login failed: ${e?.message ?? String(e)}`);
        }
    }, [addLog, clear, redirectUri]);

    // ---- scan (no upload) ----
    const scanCameraRollForFlowers = useCallback(async () => {
        addLog(`[${now()}] 📷 requesting media library permission...`);
        const perm = await MediaLibrary.requestPermissionsAsync();
        if (!perm.granted) {
            addLog(`[${now()}] ❌ media library permission denied`);
            return { summary: "no permission", hits: [] as FlowerCandidate[] };
        }

        const maxToScan = 80;
        addLog(`[${now()}] listing recent images (max ${maxToScan})...`);

        // Use the enum-safe form to avoid sort bugs:
        const page = await MediaLibrary.getAssetsAsync({
            mediaType: MediaLibrary.MediaType.photo,
            sortBy: [MediaLibrary.SortBy.creationTime],
            first: maxToScan,
        });

        addLog(`[${now()}] found ${page.assets.length} assets`);

        // Warmup on first available image (optional but helps)
        if (page.assets[0]) {
            try {
                const info0 = await MediaLibrary.getAssetInfoAsync(page.assets[0]);
                const uri0 = info0.localUri ?? info0.uri;
                if (uri0) {
                    const warm = await ImageManipulator.manipulateAsync(
                        uri0,
                        [{ resize: { width: 224 } }],
                        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
                    );
                    addLog(`[${now()}] warming up flowerDetector...`);
                    await flowerDetector.warmup(warm.uri);
                    addLog(`[${now()}] ✅ warmup done`);
                }
            } catch (e) {
                addLog(`[${now()}] ⚠️ warmup failed (continuing): ${toErrString(e)}`);
            }
        }

        const hits: FlowerCandidate[] = [];

        for (let idx = 0; idx < page.assets.length; idx++) {
            const a = page.assets[idx];

            let uri: string | null = null;
            try {
                const info = await MediaLibrary.getAssetInfoAsync(a);
                uri = info.localUri ?? info.uri ?? null;
            } catch (e) {
                addLog(`[${now()}] ⚠️ getAssetInfo failed idx=${idx}: ${toErrString(e)}`);
                continue;
            }
            if (!uri) continue;

            try {
                const preview = await ImageManipulator.manipulateAsync(
                    uri,
                    [{ resize: { width: 224 } }],
                    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
                );

                addLog(`[${now()}] 🔎 classify ${idx + 1}/${page.assets.length}...`);
                const isFlower = await flowerDetector.isFlowerImage(preview.uri);
                if (!isFlower) continue;

                const safe = safeIdForFilename(a.id);
                hits.push({
                    assetId: canonicalAssetId(a.id),
                    uri,
                    suggestedName: `flower_${Date.now()}_${safe}.jpg`,
                });

                const canonId = canonicalAssetId(a.id);
                addLog(`[${now()}] 🌸 hit: raw=${a.id} canon=${canonId}`);
                if (hits.length >= 20) break; // keep prompt small
            } catch (e) {
                addLog(`[${now()}] ⚠️ classify failed id=${a.id}: ${toErrString(e)}`);
            }
        }

        const summary =
            `Found ${hits.length} flower candidates.\n` +
            hits.slice(0, 12).map((h, i) => `${i + 1}. id=${canonicalAssetId(h.assetId)}`).join("\n");

        setCandidates(hits);
        setScanSummary(summary);
        addLog(`[${now()}] ✅ scanSummary ready for LLM:\n${summary}`);

        return { summary, hits };
    }, [addLog]);



    // ---- LLM ----
    const llm = useLLM({ model: LOCAL_LLM_MODEL });

    // Decide confirmation in code (do NOT ask model)
    function wantsImmediateUpload(text: string) {
        const t = (text || "").toLowerCase();
        return (
            t.includes("upload directly") ||
            t.includes("upload now") ||
            t.includes("upload immediately") ||
            t.includes("upload right now") ||
            (t.includes("upload") && t.includes("direct"))
        );
    }
    function extractBetween(text: string, a: string, b: string) {
        const i = text.indexOf(a);
        if (i === -1) return null;
        const j = text.indexOf(b, i + a.length);
        if (j === -1) return null;
        return text.slice(i + a.length, j).trim();
    }

    function parseJsonArrayBetweenMarkers(raw: string) {
        const inner = extractBetween(raw, "<<<JSON>>>", "<<<END_JSON>>>");
        if (!inner) return null;
        try {
            const v = JSON.parse(inner);
            return Array.isArray(v) ? v : null;
        } catch {
            return null;
        }
    }
    // Keep scan->LLM payload tiny: IDs only
    function extractIdsFromScan(scanText: string) {
        // supports: "id=XYZ", "id = XYZ", "id: XYZ"
        const ids = Array.from(
            scanText.matchAll(/\bid\s*[:=]\s*([^\s]+)/gi)
        ).map((m) => canonicalAssetId(m[1]));

        return Array.from(new Set(ids));
    }

    // Find a JSON array anywhere in the output (more robust than object-only)
    function extractFirstJsonArray(text: string) {
        const start = text.indexOf("[");
        if (start === -1) return null;

        let depth = 0;
        let inStr = false;
        let esc = false;

        for (let i = start; i < text.length; i++) {
            const c = text[i];

            if (inStr) {
                if (esc) esc = false;
                else if (c === "\\") esc = true;
                else if (c === '"') inStr = false;
                continue;
            } else {
                if (c === '"') { inStr = true; continue; }
                if (c === "[") depth++;
                if (c === "]") depth--;
                if (depth === 0) {
                    const candidate = text.slice(start, i + 1).trim();
                    try { return JSON.parse(candidate); } catch { return null; }
                }
            }
        }
        return null;
    }

    // Ultra-short system prompt helps small LLMs comply
    const SYSTEM_IDS_ONLY =
        'Output ONLY a JSON array of strings. Example: ["id1","id2"]. No other text.';

    // Even stricter retry prompt
    const SYSTEM_IDS_ONLY_RETRY =
        'OUTPUT ONLY JSON ARRAY. First char "[" last char "]". No other characters.';


    const runLLM = useCallback(async (scanText: string) => {
        if (llm.error) throw new Error(`LLM error: ${toErrString(llm.error)}`);
        if (!llm.isReady) throw new Error("LLM not ready yet");
        if (llm.isGenerating) throw new Error("LLM is already generating");

        const ids = extractIdsFromScan(scanText).slice(0, 20);
        if (ids.length === 0) {
            addLog(`[${now()}] ⚠️ No IDs extracted from scanSummary`);
            return { selected_asset_ids: [] as string[] };
        }

        // (Optional) if there's only 1 candidate, skip LLM entirely
        if (ids.length === 1) {
            addLog(`[${now()}] ✅ Only 1 candidate -> auto-selecting without LLM`);
            return { selected_asset_ids: [ids[0]] };
        }

        // 1st attempt
        llm.configure({
            chatConfig: {
                systemPrompt: SYSTEM_IDS_ONLY,
                initialMessageHistory: [],
                contextWindowLength: 768,
            },
            generationConfig: {
                temperature: 0.0,
                topp: 0.9,
            },
        });

        const clippedInstr = instruction.trim().slice(0, 180);
        const userPrompt =
            `Instruction:\n${clippedInstr}\n\n` +
            `Choose which of the following IDs should be uploaded:\n` +
            ids.map((id) => `- ${id}`).join("\n") +
            `\nReturn ONLY a JSON array of IDs.`;

        addLog(`[${now()}] LLM sendMessage start...`);
        await llm.sendMessage(userPrompt);

        const raw1 = (llm.response ?? "").trim();
        setAssistantText(raw1);
        addLog(`[${now()}] LLM raw tail:\n${raw1.slice(-300)}`);

        let arr = extractJsonArrayAnywhere(raw1);

        // retry
        if (!arr) {
            addLog(`[${now()}] ⚠️ LLM did not return JSON array; retrying...`);

            llm.configure({
                chatConfig: {
                    systemPrompt: SYSTEM_IDS_ONLY_RETRY,
                    initialMessageHistory: [],
                    contextWindowLength: 512,
                },
                generationConfig: { temperature: 0.0, topp: 0.9 },
            });

            // HARD anchor to '[' ... ']'
            const retryPrompt =
                `Return ONLY a JSON array of chosen IDs.\n` +
                `Allowed IDs:\n${ids.map((x) => `- ${x}`).join("\n")}\n\n` +
                `Output:\n[`;

            await llm.sendMessage(retryPrompt);

            const raw2 = (llm.response ?? "").trim();
            setAssistantText(raw2);
            addLog(`[${now()}] LLM retry tail:\n${raw2.slice(-300)}`);

            arr = extractJsonArrayAnywhere(raw2);
            if (!arr) throw new Error(`Could not parse JSON array from LLM after retry:\n${raw2}`);
        }

        // clamp to allowed IDs
        const allowed = new Set(ids);
        const selected_asset_ids = arr.filter((x) => allowed.has(x));

        return { selected_asset_ids };
    }, [addLog, instruction, llm]);

    // ---- upload chosen assets ----
    const uploadFromAction = useCallback(async (action: UploadAction, candidatesNow: FlowerCandidate[]) => {
        if (!accessToken) {
            addLog(`[${now()}] ❌ not logged in`);
            return;
        }

        const ids = (action?.selected_asset_ids ?? []) as string[];
        const uploadPath = "shared/";

        if (!Array.isArray(ids) || ids.length === 0) {
            addLog(`[${now()}] (LLM selected no assets to upload)`);
            return;
        }
        if (uploadPath !== "shared/") {
            addLog(`[${now()}] ❌ refusing upload: upload_path must be 'shared/'`);
            return;
        }

        const wanted = new Set((action.selected_asset_ids ?? []).map(canonicalAssetId));
        const selected = candidatesNow.filter((c) => wanted.has(canonicalAssetId(c.assetId)));
        if (selected.length === 0) {
            addLog(`[${now()}] ❌ none of selected_asset_ids matched current scan results`);
            return;
        }

        addLog(`[${now()}] 🚀 uploading ${selected.length} image(s) to /shared/ ...`);
        for (const c of selected) {
            const uploadJpg = await ImageManipulator.manipulateAsync(
                c.uri,
                [{ resize: { width: 1024 } }],
                { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
            );

            const uploadUrl = `${POD_BASE}shared/${c.suggestedName}`;

            try {
                addLog(
                    `[${now()}] PUT(file) ${uploadUrl} (jpgUri=${uploadJpg.uri})`
                );

                await putFile(uploadUrl, accessToken, uploadJpg.uri, "image/jpeg");

                addLog(`[${now()}] ✅ PUT ok ${c.suggestedName}`);
            } catch (e: any) {
                const d = diagnoseNetworkError(e, {
                    step: "putFile",
                    url: uploadUrl,
                    token: accessToken,
                    blob: null,
                    uri: uploadJpg.uri,
                });

                addLog(`[${now()}] ❌ upload failed: ${d.extra}`);
                if (d.hints.length) addLog(`[${now()}] 🔎 hints: ${d.hints.join(" | ")}`);
                throw e;
            }
        }
    }, [accessToken, addLog, candidates]);

    // ---- One button: scan -> LLM -> maybe auto-upload ----
    const askLLMAndMaybeUpload = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        clear();
        lastUploadKeyRef.current = ""; // ✅ allow upload every button press

        try {

            // 1) scan first (no upload)

            // 2) LLM decides action
            // 2) LLM returns IDs only; we build the full action in code
            const { summary, hits } = await scanCameraRollForFlowers();
            const idsResult = await runLLM(summary);

            const action: UploadAction = {
                query: instruction,
                filters: {},
                require_confirm: false,
                upload_path: "shared/",
                selected_asset_ids: idsResult.selected_asset_ids,
            };

            // pass hits directly (fresh), not state
            await uploadFromAction(action, hits);

            const uploadNow = true; // you want no confirmation ever


            setPendingAction(action);
            // 3) manifest upload (optional)
            try {
                const manifestUrl = `${POD_BASE}fl/llm_manifest_${Date.now()}.json`;
                await putText(manifestUrl, accessToken, JSON.stringify({
                    created_at: new Date().toISOString(),
                    instruction,
                    scanSummary: summary,
                    action,
                }, null, 2), "application/json");
                addLog(`[${now()}] ✅ manifest uploaded`);
            } catch (e) {
                addLog(`[${now()}] ⚠️ manifest upload failed (continuing): ${toErrString(e)}`);
            }

            // 4) If require_confirm=false, auto-upload exactly once per action
            const key = JSON.stringify({
                ids: action?.selected_asset_ids ?? [],
                path: action?.upload_path ?? "shared/",
                confirm: action?.require_confirm ?? true,
            });

            if (action?.require_confirm === false) {
                if (lastUploadKeyRef.current === key) {
                    addLog(`[${now()}] (skipping: already uploaded for this exact action key)`);
                } else {
                    try {
                        lastUploadKeyRef.current = key; // ✅ only set after success
                        setPendingAction(action);
                    } catch (e) {
                        addLog(`[${now()}] ⚠️ upload failed; not marking as uploaded`);
                        throw e;
                    }
                }
            } else {
                addLog(`[${now()}] (LLM requires confirm; not auto-uploading)`);
                Alert.alert("Confirm required", "LLM decided this needs confirmation (require_confirm=true).");
            }
        } catch (e: any) {
            addLog(`❌ generate threw (String): ${String(e)}`);
            addLog(`❌ typeof: ${typeof e}`);
            addLog(`❌ message: ${e?.message ?? "(none)"}`);
            addLog(`❌ name: ${e?.name ?? "(none)"}`);
            addLog(`❌ stack: ${e?.stack ?? "(none)"}`);

            try {
                addLog(`❌ ownProps: ${Object.getOwnPropertyNames(e).join(", ")}`);
                for (const k of Object.getOwnPropertyNames(e)) {
                    // @ts-ignore
                    addLog(`   - ${k}: ${String(e[k])}`);
                }
            } catch { }

            // Sometimes useful:
            try { addLog(`❌ keys: ${Object.keys(e).join(", ")}`); } catch { }

            return "";
        } finally {
            setBusy(false);
        }
    }, [
        accessToken,
        addLog,
        busy,
        clear,
        instruction,
        runLLM,
        scanCameraRollForFlowers,
        uploadFromAction,
    ]);

    return (
        <SafeAreaView style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
                <Text style={{ fontSize: 20, fontWeight: "600" }}>
                    SolidFL Mobile (LLM decides flower uploads)
                </Text>

                <Button title="Login (Solid OIDC)" onPress={login} />

                <Text style={{ fontSize: 12, color: "gray" }}>
                    token={accessToken ? "✅" : "❌"} | client_id: {clientId || "(none)"}
                </Text>

                <View style={{ height: 8 }} />

                <Text style={{ fontSize: 16, fontWeight: "600" }}>User instruction</Text>
                <TextInput
                    value={instruction}
                    onChangeText={setInstruction}
                    placeholder="e.g. upload flowers directly"
                    style={{
                        borderWidth: 1,
                        borderRadius: 8,
                        padding: 10,
                        fontSize: 14,
                    }}
                    multiline
                />

                <Text style={{ fontSize: 12, color: "gray" }}>
                    LLM ready={String(llm.isReady)} | generating={String(llm.isGenerating)} | progress=
                    {String(llm.downloadProgress)} | error={llm.error ? toErrString(llm.error) : "(none)"}
                </Text>

                <Button
                    title={busy ? "Working… (scan → LLM → maybe upload)" : "Ask LLM (may auto-upload)"}
                    onPress={askLLMAndMaybeUpload}
                    disabled={!accessToken || busy}
                />

                {scanSummary ? (
                    <View style={{ marginTop: 8 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600" }}>Scan summary (for LLM)</Text>
                        <Text style={{ fontFamily: "Courier", fontSize: 12, borderWidth: 1, borderRadius: 8, padding: 10 }}>
                            {scanSummary}
                        </Text>
                    </View>
                ) : null}

                {assistantText ? (
                    <View style={{ marginTop: 8 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600" }}>LLM raw output</Text>
                        <Text style={{ fontFamily: "Courier", fontSize: 12, borderWidth: 1, borderRadius: 8, padding: 10 }}>
                            {assistantText}
                        </Text>
                    </View>
                ) : null}

                {pendingAction ? (
                    <View style={{ marginTop: 8 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600" }}>Parsed action</Text>
                        <Text style={{ fontFamily: "Courier", fontSize: 12, borderWidth: 1, borderRadius: 8, padding: 10 }}>
                            {JSON.stringify(pendingAction, null, 2)}
                        </Text>
                    </View>
                ) : null}

                <View style={{ height: 10 }} />
                <Text style={{ fontSize: 16, fontWeight: "600" }}>Log</Text>
                <Text
                    style={{
                        borderWidth: 1,
                        borderRadius: 8,
                        padding: 10,
                        minHeight: 220,
                        fontFamily: "Courier",
                        fontSize: 12,
                    }}
                >
                    {log || "(no logs yet)"}
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}