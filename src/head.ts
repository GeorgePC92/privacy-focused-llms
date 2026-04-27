import { NUM_LABELS } from "./labels";

export type HeadWeights = {
    // W: [NUM_LABELS, D]
    W: Float32Array;
    // b: [NUM_LABELS]
    b: Float32Array;
    D: number;
};

export function initHead(D: number): HeadWeights {
    return {
        W: new Float32Array(NUM_LABELS * D),
        b: new Float32Array(NUM_LABELS),
        D,
    };
}

function sigmoid(x: number) {
    return 1 / (1 + Math.exp(-x));
}

export function predictProbs(head: HeadWeights, z: Float32Array): Float32Array {
    const { W, b, D } = head;
    const out = new Float32Array(NUM_LABELS);
    for (let c = 0; c < NUM_LABELS; c++) {
        let s = b[c];
        const row = c * D;
        for (let i = 0; i < D; i++) s += W[row + i] * z[i];
        out[c] = sigmoid(s);
    }
    return out;
}

// One SGD step on a batch of (z,y) using BCE-with-logits gradient,
// implemented using probabilities (stable enough for small head).
export function trainStep(
    head: HeadWeights,
    batchZ: Float32Array[],   // length B, each length D
    batchY: Float32Array[],   // length B, each length NUM_LABELS
    lr: number = 0.05
) {
    const { W, b, D } = head;
    const B = batchZ.length;

    // grads
    const gW = new Float32Array(W.length);
    const gb = new Float32Array(b.length);

    for (let n = 0; n < B; n++) {
        const z = batchZ[n];
        const y = batchY[n];

        // forward per class
        for (let c = 0; c < NUM_LABELS; c++) {
            let s = b[c];
            const row = c * D;
            for (let i = 0; i < D; i++) s += W[row + i] * z[i];

            const p = sigmoid(s);
            const err = (p - y[c]); // dL/dlogit for BCE

            gb[c] += err;
            for (let i = 0; i < D; i++) gW[row + i] += err * z[i];
        }
    }

    // SGD update (average over batch)
    const invB = 1 / Math.max(1, B);
    for (let i = 0; i < W.length; i++) W[i] -= lr * gW[i] * invB;
    for (let c = 0; c < b.length; c++) b[c] -= lr * gb[c] * invB;
}

export function flattenHead(head: HeadWeights): Float32Array {
    // [W..., b...]
    const out = new Float32Array(head.W.length + head.b.length);
    out.set(head.W, 0);
    out.set(head.b, head.W.length);
    return out;
}

export function applyDelta(head: HeadWeights, deltaFlat: Float32Array) {
    const Wn = head.W.length;
    for (let i = 0; i < Wn; i++) head.W[i] += deltaFlat[i];
    for (let i = 0; i < head.b.length; i++) head.b[i] += deltaFlat[Wn + i];
}

export function diffFlat(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
    return out;
}