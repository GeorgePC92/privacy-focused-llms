export function float32ToNpyBytes(arr: Float32Array): Uint8Array {
    // NPY v1.0 header
    const magic = new Uint8Array([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]); // \x93NUMPY
    const version = new Uint8Array([0x01, 0x00]);

    const shape = `(${arr.length},)`;
    let header = `{'descr': '<f4', 'fortran_order': False, 'shape': ${shape}, }`;

    // pad to 16-byte alignment with spaces + newline
    const headerLenBase = magic.length + version.length + 2; // + uint16 headerlen
    let padLen = 16 - ((headerLenBase + header.length + 1) % 16);
    if (padLen === 16) padLen = 0;
    header = header + " ".repeat(padLen) + "\n";

    const headerBytes = new TextEncoder().encode(header);

    const headerLen = headerBytes.length;
    const headerLenBytes = new Uint8Array(2);
    headerLenBytes[0] = headerLen & 0xff;
    headerLenBytes[1] = (headerLen >> 8) & 0xff;

    const dataBytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);

    const out = new Uint8Array(magic.length + version.length + 2 + headerBytes.length + dataBytes.length);
    let o = 0;
    out.set(magic, o); o += magic.length;
    out.set(version, o); o += version.length;
    out.set(headerLenBytes, o); o += 2;
    out.set(headerBytes, o); o += headerBytes.length;
    out.set(dataBytes, o); o += dataBytes.length;
    return out;
}