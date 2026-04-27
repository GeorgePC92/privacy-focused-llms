// App.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
    Button,
    SafeAreaView,
    ScrollView,
    Text,
    View,
    Switch,
    TextInput,
    Alert,
} from "react-native";

import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";

import * as MediaLibrary from "expo-media-library";
import * as ImageManipulator from "expo-image-manipulator";

import { useLLM, type Message } from "react-native-executorch";

import { LABELS, NUM_LABELS } from "./src/labels";
import { addSample, loadSamples, clearSamples } from "./src/storage";
import { initHead, predictProbs, trainStep, flattenHead, diffFlat } from "./src/head";
import { putNpy, putText, putBlob } from "./src/solid";
import { LLMAction } from "./src/llmAction";

WebBrowser.maybeCompleteAuthSession();

// Hardcode endpoints (NO discovery)
const AUTH_ENDPOINT = "https://pods.solidcommunity.au/.oidc/auth";
const TOKEN_ENDPOINT = "https://pods.solidcommunity.au/.oidc/token";
const REG_ENDPOINT = "https://pods.solidcommunity.au/.oidc/reg";

// Solid upload target (ensure trailing slash)
const POD_BASE = "https://pods.solidcommunity.au/TestPod1/";
const JOB_ID = "flair_job_1";
const CLIENT_TAG = "mobile_1";

// ===== helpers =====
function now() {
    return new Date().toISOString().replace("T", " ").replace("Z", "");
}
function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
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
async function fetchWithDebug(
    addLog: (s: string) => void,
    url: string,
    init?: RequestInit,
    timeoutMs = 20000
) {
    const method = init?.method ?? "GET";
    addLog(`[${now()}] fetch ${method} ${url}`);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        addLog(`[${now()}] -> ${res.status} ${res.statusText}`);
        return res;
    } catch (e: any) {
        addLog(`[${now()}] !!! fetch error: ${e?.message ?? String(e)}`);
        throw e;
    } finally {
        clearTimeout(t);
    }
}
async function dynamicRegister(addLog: (s: string) => void, redirectUri: string): Promise<string> {
    const body = {
        client_name: "SolidFL Mobile (Expo Dev Build)",
        application_type: "native",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
    };

    let lastErr: any = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
        try {
            addLog(`[${now()}] reg attempt ${attempt}/6`);
            const res = await fetchWithDebug(addLog, REG_ENDPOINT, {
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
async function exchangeToken(
    addLog: (s: string) => void,
    params: { code: string; codeVerifier: string; clientId: string; redirectUri: string }
) {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", params.code);
    body.set("redirect_uri", params.redirectUri);
    body.set("client_id", params.clientId);
    body.set("code_verifier", params.codeVerifier);

    const res = await fetchWithDebug(addLog, TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
    });

    const txt = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${res.statusText}\n${txt}`);
    return JSON.parse(txt) as { access_token: string; token_type: string; expires_in?: number };
}

function topK(probs: Float32Array, k = 5) {
    const idx = [...probs.keys()];
    idx.sort((a, b) => probs[b] - probs[a]);
    return idx.slice(0, k).map((i) => ({ i, label: LABELS[i], p: probs[i] }));
}

//	ppppp

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

// ===== LLM model assets (BUNDLED) =====
const LOCAL_LLM_MODEL = {
    modelSource: require("./local-llm/fine-tuning/fine_tuned_qwen3_06b.pte"),
    tokenizerSource: require("./local-llm/fine-tuning/tokenizer.tok"),
    tokenizerConfigSource: require("./local-llm/fine-tuning/tokenizer_config.tokcfg"),
};

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
            if (c === '"') {
                inStr = true;
                continue;
            }
            if (c === "{") depth++;
            if (c === "}") depth--;
            if (depth === 0) {
                const candidate = text.slice(start, i + 1).trim();
                try {
                    return JSON.parse(candidate);
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

function LLMRunner(props: {
    instruction: string;
    onLog: (s: string) => void;
    onAssistantText: (s: string) => void;
    onAction: (a: LLMAction) => void;
}) {
    const { instruction, onLog, onAssistantText, onAction } = props;

    const llm = useLLM({ model: LOCAL_LLM_MODEL });

    const ask = useCallback(async () => {
        const log = (s: string) => onLog(`[${now()}] ${s}`);

        if (llm.error) return log(`❌ LLM error: ${toErrString(llm.error)}`);
        if (!llm.isReady) return log(`⏳ LLM loading...`);

        const system =
            "Return ONLY a JSON object.\n" +
            "No other text.\n" +
            "Keys: query, filters, require_confirm, upload_path.\n" +
            "Keep it compact.\n";

        const messages: Message[] = [
            { role: "system", content: system },
            { role: "user", content: instruction },
        ];

        log(`generate start`);
        try {
            // @ts-ignore
            await llm.generate(messages);
        } catch (e) {
            log(`❌ generate threw: ${toErrString(e)}`);
            return;
        }

        const raw = llm.response ?? "";
        onAssistantText(raw);
        log(`done chars=${raw.length}`);

        const obj = extractFirstJsonObject(raw);
        if (!obj) {
            log(`❌ JSON missing/truncated. Raw:\n${raw}`);
            return;
        }

        onAction(obj as LLMAction);
        log(`✅ parsed action ok`);
    }, [instruction, llm, onAction, onAssistantText, onLog]);

    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, color: "gray" }}>
                LLM: ready={String(llm.isReady)} | generating={String(llm.isGenerating)} | progress=
                {String(llm.downloadProgress)} | error={llm.error ? toErrString(llm.error) : "(none)"}
            </Text>
            <Button title="Ask LLM → produce action" onPress={ask} />
        </View>
    );
}

// ===== App =====
export default function App() {
    const [log, setLog] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [clientId, setClientId] = useState("");

    // Tiny head demo state
    const [embedDim, setEmbedDim] = useState<number | null>(null);
    const [head, setHead] = useState<any>(null);
    const [globalFlat, setGlobalFlat] = useState<Float32Array | null>(null);
    const [lastEmbedding, setLastEmbedding] = useState<Float32Array | null>(null);
    const [predTop, setPredTop] = useState<{ i: number; label: string; p: number }[]>([]);
    const [labelState, setLabelState] = useState<boolean[]>(Array(NUM_LABELS).fill(false));

    // LLM state
    const [instruction, setInstruction] = useState(
        "Upload photos from today. Don't upload pictures of children, nudity or PII. Downsized only. Strip metadata."
    );
    const [assistantText, setAssistantText] = useState("");
    const [pendingAction, setPendingAction] = useState<LLMAction | null>(null);
    const [llmMounted, setLlmMounted] = useState(false);

    // Flower scanner state
    const [scanBusy, setScanBusy] = useState(false);
    const [maxToScan, setMaxToScan] = useState("50");
    const [maxToUpload, setMaxToUpload] = useState("10");
    const [DEV_TREAT_ALL_AS_FLOWERS, setDevTreatAllAsFlowers] = useState(true);

    const addLog = useCallback((line: string) => {
        setLog((p) => (p ? p + "\n" : "") + line);
    }, []);
    const clear = useCallback(() => setLog(""), []);

    const redirectUri = useMemo(() => {
        return AuthSession.makeRedirectUri({ scheme: "com.anonymous.solidfl", path: "auth" });
    }, []);

    const initLLM = useCallback(() => {
        clear();
        addLog(`[${now()}] init LLM requested (mounting LLMRunner)...`);
        setLlmMounted(true);
    }, [addLog, clear]);

    const login = useCallback(async () => {
        clear();
        setAccessToken("");
        setClientId("");
        try {
            addLog(`[${now()}] redirectUri: ${redirectUri}`);

            let codeVerifier = "";
            for (let tries = 0; tries < 5; tries++) {
                const bytes = await Crypto.getRandomBytesAsync(64);
                codeVerifier = base64UrlFromBytes(bytes);
                if (codeVerifier.length >= 43) break;
            }
            const codeChallenge = await sha256Base64Url(codeVerifier);

            const newClientId = await dynamicRegister(addLog, redirectUri);
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

            const tok = await exchangeToken(addLog, {
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

    // --------- NO-UI flower scan + upload ----------
    const scanAndUploadFlowers = useCallback(async () => {
        if (!accessToken) {
            Alert.alert("Not logged in", "Login first so we can upload to your Pod.");
            return;
        }
        if (scanBusy) return;

        const scanN = Math.max(1, Math.min(500, parseInt(maxToScan || "50", 10) || 50));
        const uploadN = Math.max(1, Math.min(200, parseInt(maxToUpload || "10", 10) || 10));

        setScanBusy(true);
        try {
            addLog(`[${now()}] 📷 requesting media library permission...`);
            const perm = await MediaLibrary.requestPermissionsAsync();
            if (!perm.granted) {
                addLog(`[${now()}] ❌ media library permission denied`);
                return;
            }

            addLog(`[${now()}] listing recent images (max ${scanN})...`);
            const page = await MediaLibrary.getAssetsAsync({
                mediaType: "photo",
                sortBy: [["creationTime", false]],
                first: scanN,
            });

            addLog(`[${now()}] found ${page.assets.length} assets`);
            let uploaded = 0;

            for (let idx = 0; idx < page.assets.length; idx++) {
                if (uploaded >= uploadN) break;

                const a = page.assets[idx];
                const info = await MediaLibrary.getAssetInfoAsync(a);
                const uri = info.localUri ?? info.uri;
                if (!uri) continue;

                // Downsize (fast path) – later feed this into your on-device flower detector
                const small = await ImageManipulator.manipulateAsync(
                    uri,
                    [{ resize: { width: 640 } }],
                    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
                );

                // TODO: replace with real detector:
                const isFlower = DEV_TREAT_ALL_AS_FLOWERS ? true : false;
                if (!isFlower) continue;

                // Upload sanitized JPEG (re-encode -> strips metadata in practice)
                const uploadJpg = await ImageManipulator.manipulateAsync(
                    uri,
                    [{ resize: { width: 1024 } }],
                    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
                );

                const blob = await (await fetch(uploadJpg.uri)).blob();
                const filename = `flower_${Date.now()}_${a.id}.jpg`;
                const uploadUrl = `${POD_BASE}shared/${filename}`;

                addLog(`[${now()}] 🌸 uploading ${filename} -> shared/`);
                await putBlob(uploadUrl, accessToken, blob, "image/jpeg");

                uploaded++;
                addLog(`[${now()}] ✅ uploaded (${uploaded}/${uploadN})`);
            }

            addLog(`[${now()}] done. uploaded=${uploaded}`);
            if (uploaded === 0) {
                addLog(
                    `[${now()}] (no uploads) — if you haven’t wired a detector yet, keep DEV_TREAT_ALL_AS_FLOWERS=true`
                );
            }
        } catch (e) {
            addLog(`[${now()}] ❌ scan/upload failed: ${toErrString(e)}`);
        } finally {
            setScanBusy(false);
        }
    }, [DEV_TREAT_ALL_AS_FLOWERS, accessToken, addLog, maxToScan, maxToUpload, scanBusy]);

    // ------- your existing tiny-head stuff (unchanged) -------
    const toggleLabel = useCallback((i: number) => {
        setLabelState((prev) => {
            const next = [...prev];
            next[i] = !next[i];
            return next;
        });
    }, []);

    const confirmLabel = useCallback(async () => {
        if (!lastEmbedding) {
            addLog(`[${now()}] ❌ no embedding yet (pick an image first)`);
            return;
        }
        const y = labelState.map((v) => (v ? 1 : 0));
        await addSample({ z: Array.from(lastEmbedding), y, t: Date.now() });
        addLog(`[${now()}] ✅ saved sample (embedding+labels) locally`);
    }, [addLog, labelState, lastEmbedding]);

    const trainLocal = useCallback(async () => {
        if (!head) {
            addLog(`[${now()}] ❌ head not initialized (pick an image first)`);
            return;
        }
        const samples = await loadSamples();
        if (samples.length === 0) {
            addLog(`[${now()}] ❌ no samples yet`);
            return;
        }

        const batchZ: Float32Array[] = [];
        const batchY: Float32Array[] = [];
        for (const s of samples) {
            batchZ.push(new Float32Array(s.z));
            batchY.push(new Float32Array(s.y));
        }

        addLog(`[${now()}] training head on ${samples.length} samples...`);
        for (let e = 0; e < 5; e++) trainStep(head, batchZ, batchY, 0.05);

        if (lastEmbedding) {
            const probs = predictProbs(head, lastEmbedding);
            setPredTop(topK(probs, 5));
        }
        setHead({ ...head });
        addLog(`[${now()}] ✅ local training done`);
    }, [addLog, head, lastEmbedding]);

    const uploadDelta = useCallback(async () => {
        if (!accessToken) {
            addLog(`[${now()}] ❌ not logged in`);
            return;
        }
        if (!head || !globalFlat) {
            addLog(`[${now()}] ❌ head/global not initialized`);
            return;
        }

        const curFlat = flattenHead(head);
        const delta = diffFlat(curFlat, globalFlat);

        const url = `${POD_BASE}fl/${JOB_ID}/uploads/round_0/client_${CLIENT_TAG}.npy`;
        addLog(`[${now()}] uploading delta npy -> ${url}`);
        await putNpy(url, accessToken, delta);
        addLog(`[${now()}] ✅ uploaded delta`);
        setGlobalFlat(curFlat);
    }, [accessToken, addLog, globalFlat, head]);

    const resetLocal = useCallback(async () => {
        await clearSamples();
        setLastEmbedding(null);
        setPredTop([]);
        setLabelState(Array(NUM_LABELS).fill(false));
        addLog(`[${now()}] cleared local samples`);
    }, [addLog]);

    const confirmAndUploadManifest = useCallback(async () => {
        if (!accessToken) {
            Alert.alert("Not logged in", "Login first so we can upload to your Pod.");
            return;
        }
        if (!pendingAction) {
            Alert.alert("No action", "Ask the LLM first to generate an action.");
            return;
        }

        const manifest = {
            created_at: new Date().toISOString(),
            instruction,
            action: pendingAction,
        };

        const url = `${POD_BASE}fl/${JOB_ID}/uploads/llm_manifest_${Date.now()}.json`;
        addLog(`[${now()}] uploading manifest -> ${url}`);
        await putText(url, accessToken, JSON.stringify(manifest, null, 2), "application/json");
        addLog(`[${now()}] ✅ manifest uploaded`);
    }, [accessToken, addLog, instruction, pendingAction]);

    return (
        <SafeAreaView style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
                <Text style={{ fontSize: 20, fontWeight: "600" }}>
                    SolidFL Mobile (Tiny Head + on-device LLM via ExecuTorch)
                </Text>

                <Button title="Login (Solid OIDC)" onPress={login} />

                <View style={{ height: 8 }} />
                <Text style={{ fontSize: 16, fontWeight: "600" }}>LLM Upload Planner</Text>

                <Button
                    title={llmMounted ? "LLM Initialized ✅" : "Init LLM (load bundled .pte + tokenizer)"}
                    onPress={initLLM}
                />

                <TextInput
                    value={instruction}
                    onChangeText={setInstruction}
                    placeholder="e.g. Upload photos from today but not kids, nudity, screenshots, plates"
                    style={{
                        borderWidth: 1,
                        borderRadius: 8,
                        padding: 10,
                        fontSize: 14,
                    }}
                    multiline
                />

                {llmMounted ? (
                    <LLMRunner
                        instruction={instruction}
                        onLog={addLog}
                        onAssistantText={setAssistantText}
                        onAction={(a) => setPendingAction(a)}
                    />
                ) : (
                    <Text style={{ fontSize: 12, color: "gray" }}>
                        Tap “Init LLM” to load the on-device model.
                    </Text>
                )}

                <Button
                    title="Confirm & Upload manifest to Solid"
                    onPress={confirmAndUploadManifest}
                    disabled={!accessToken || !pendingAction}
                />

                {assistantText ? (
                    <View style={{ marginTop: 8 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600" }}>Assistant output</Text>
                        <Text style={{ fontFamily: "Courier", fontSize: 12, borderWidth: 1, borderRadius: 8, padding: 10 }}>
                            {assistantText}
                        </Text>
                    </View>
                ) : null}

                {pendingAction ? (
                    <View style={{ marginTop: 6 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600" }}>Parsed action</Text>
                        <Text style={{ fontFamily: "Courier", fontSize: 12, borderWidth: 1, borderRadius: 8, padding: 10 }}>
                            {JSON.stringify(pendingAction, null, 2)}
                        </Text>
                    </View>
                ) : null}

                <View style={{ height: 14 }} />
                <Text style={{ fontSize: 16, fontWeight: "600" }}>Auto Flower Scanner (no human selection)</Text>

                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 14 }}>DEV: treat all images as flowers</Text>
                    <Switch value={DEV_TREAT_ALL_AS_FLOWERS} onValueChange={setDevTreatAllAsFlowers} />
                </View>

                <Text style={{ fontSize: 12, color: "gray" }}>maxToScan</Text>
                <TextInput
                    value={maxToScan}
                    onChangeText={setMaxToScan}
                    keyboardType="number-pad"
                    style={{ borderWidth: 1, borderRadius: 8, padding: 8 }}
                />

                <Text style={{ fontSize: 12, color: "gray" }}>maxToUpload</Text>
                <TextInput
                    value={maxToUpload}
                    onChangeText={setMaxToUpload}
                    keyboardType="number-pad"
                    style={{ borderWidth: 1, borderRadius: 8, padding: 8 }}
                />

                <Button
                    title={scanBusy ? "Scanning… (please wait)" : "Scan camera roll → upload flowers to /shared/"}
                    onPress={scanAndUploadFlowers}
                    disabled={!accessToken || scanBusy}
                />

                <View style={{ height: 14 }} />
                <Text style={{ fontSize: 16, fontWeight: "600" }}>Tiny-head demo (optional)</Text>
                <Button title="Save annotation (labels)" onPress={confirmLabel} />
                <Button title="Train locally (head only)" onPress={trainLocal} />
                <Button title="Upload delta.npy to Solid" onPress={uploadDelta} disabled={!accessToken} />
                <Button title="Reset local samples" onPress={resetLocal} />

                <View style={{ height: 8 }} />
                <Text style={{ fontSize: 12 }}>redirectUri: {redirectUri}</Text>
                <Text style={{ fontSize: 12 }}>client_id: {clientId || "(none)"}</Text>
                <Text style={{ fontSize: 12 }}>embedDim: {embedDim ?? "(none)"}</Text>

                <View style={{ height: 10 }} />
                <Text style={{ fontSize: 16, fontWeight: "600" }}>Predictions</Text>
                {predTop.length === 0 ? (
                    <Text style={{ fontSize: 12 }}>(no predictions)</Text>
                ) : (
                    predTop.map((t) => (
                        <Text key={t.label} style={{ fontSize: 12 }}>
                            {t.label}: {t.p.toFixed(3)}
                        </Text>
                    ))
                )}

                <View style={{ height: 10 }} />
                <Text style={{ fontSize: 16, fontWeight: "600" }}>Labels</Text>
                {LABELS.map((lbl, i) => (
                    <View
                        key={lbl}
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            paddingVertical: 4,
                        }}
                    >
                        <Text style={{ fontSize: 14 }}>{lbl}</Text>
                        <Switch value={labelState[i]} onValueChange={() => toggleLabel(i)} />
                    </View>
                ))}

                <View style={{ height: 14 }} />
                <Text style={{ fontSize: 16, fontWeight: "600" }}>Log</Text>
                <Text style={{ borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 220, fontFamily: "Courier", fontSize: 12 }}>
                    {log || "(no logs yet)"}
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}