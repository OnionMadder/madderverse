/* ============================================================
   Web Push primitives — VAPID + aes128gcm payload encryption
   ============================================================
   Hand-rolled against Web Crypto so we have zero Node-only deps
   and the same code path works in `wrangler dev` and prod.

   Specs:
     RFC 8030  HTTP Web Push protocol
     RFC 8188  Encrypted Content-Encoding for HTTP (aes128gcm)
     RFC 8291  Message Encryption for Web Push
     RFC 8292  Voluntary Application Server Identification (VAPID)

   This file is intentionally self-contained — no imports from
   the rest of the worker. Tests / replacement implementations
   would only touch this file.
   ============================================================ */

/* ----- 1. base64url helpers ----- */

export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(input: string): Uint8Array {
    /* Tolerate padded base64 or unpadded base64url. */
    const s = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
    const padded = s + "=".repeat(pad);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
    const len = arrs.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(len);
    let off = 0;
    for (const a of arrs) { out.set(a, off); off += a.length; }
    return out;
}

/* TS 5.7+ tightened Uint8Array<ArrayBufferLike> so it no longer
   assigns to BufferSource (because BufferSource implies a plain
   ArrayBuffer, not SharedArrayBuffer). Web Crypto + fetch in
   Workers happily accept any Uint8Array, so this cast just
   silences a typing regression that doesn't reflect runtime. */
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/* ----- 2. VAPID JWT (ES256) ----- */

interface VapidKeys {
    publicKey:  string;   /* base64url, 65-byte uncompressed P-256 */
    privateKey: string;   /* base64url, 32-byte scalar */
    subject:    string;   /* "mailto:..." or "https://..." */
}

/* Cache the imported ECDSA signing key per Worker instance so we
   don't reimport the JWK on every send. The key material is
   identical across the lifetime of the Worker. */
let _signingKey: CryptoKey | null = null;
let _signingKeyFor = "";

async function getSigningKey(keys: VapidKeys): Promise<CryptoKey> {
    if (_signingKey && _signingKeyFor === keys.privateKey) return _signingKey;

    const pubRaw = b64urlDecode(keys.publicKey);
    if (pubRaw.length !== 65 || pubRaw[0] !== 0x04) {
        throw new Error("VAPID public key must be 65-byte uncompressed P-256");
    }
    const x = pubRaw.slice(1, 33);
    const y = pubRaw.slice(33, 65);
    const d = b64urlDecode(keys.privateKey);
    if (d.length !== 32) {
        throw new Error("VAPID private key must decode to 32 bytes");
    }

    const jwk: JsonWebKey = {
        kty: "EC",
        crv: "P-256",
        x:   b64urlEncode(x),
        y:   b64urlEncode(y),
        d:   b64urlEncode(d),
        ext: true
    };

    const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
    );

    _signingKey = key;
    _signingKeyFor = keys.privateKey;
    return key;
}

/* Build a VAPID JWT for the given push-service origin.
   `aud` is the scheme+host of the subscription endpoint (per
   RFC 8292 §2). `exp` is bounded at 24h; we pick 12h for headroom. */
export async function vapidAuthorizationHeader(
    endpoint: string,
    keys: VapidKeys
): Promise<string> {
    const url = new URL(endpoint);
    const aud = url.origin;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 12 * 60 * 60;

    const header  = { typ: "JWT", alg: "ES256" };
    const payload = { aud, exp, sub: keys.subject };

    const headerB64  = b64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const signingInput = headerB64 + "." + payloadB64;

    const sigBuf = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        await getSigningKey(keys),
        new TextEncoder().encode(signingInput)
    );
    /* Web Crypto returns ECDSA sigs in raw R||S (64 bytes for
       P-256) which is exactly what JWS expects. No DER unwrap. */
    const jwt = signingInput + "." + b64urlEncode(new Uint8Array(sigBuf));

    return "vapid t=" + jwt + ", k=" + keys.publicKey;
}

/* ----- 3. aes128gcm payload encryption (RFC 8291) ----- */

interface PushKeys {
    p256dh: string;   /* base64url UA public key (uncompressed P-256) */
    auth:   string;   /* base64url 16-byte UA auth secret */
}

/* HKDF-derive `length` bytes from `ikm` using `salt` and `info`.
   Web Crypto's HKDF deriveBits does Extract+Expand in one shot,
   which is exactly the per-step shape RFC 8291 calls for.    */
async function hkdf(
    salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number
): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
        "raw", buf(ikm), "HKDF", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) },
        key,
        length * 8
    );
    return new Uint8Array(bits);
}

/* Encrypt `payload` (UTF-8 already encoded) for the given UA
   subscription. Returns the full aes128gcm record body, ready
   to POST. */
export async function encryptPayload(
    payload: Uint8Array,
    keys: PushKeys
): Promise<Uint8Array> {
    const uaPub  = b64urlDecode(keys.p256dh);     /* 65 bytes */
    const auth   = b64urlDecode(keys.auth);       /* 16 bytes */
    const salt   = crypto.getRandomValues(new Uint8Array(16));

    /* Ephemeral application-server EC key for this single push. */
    const eph = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
    );
    const asPubBuf = await crypto.subtle.exportKey("raw", eph.publicKey);
    const asPub    = new Uint8Array(asPubBuf);    /* 65 bytes */

    const uaPubKey = await crypto.subtle.importKey(
        "raw", buf(uaPub),
        { name: "ECDH", namedCurve: "P-256" },
        false, []
    );

    const sharedBuf = await crypto.subtle.deriveBits(
        { name: "ECDH", public: uaPubKey },
        eph.privateKey,
        256
    );
    const shared = new Uint8Array(sharedBuf);

    /* PRK_key step:
       key_info = "WebPush: info\0" || ua_public || as_public
       IKM      = HKDF(auth, shared, key_info, 32)                 */
    const keyInfo = concat(
        new TextEncoder().encode("WebPush: info\0"),
        uaPub,
        asPub
    );
    const ikm = await hkdf(auth, shared, keyInfo, 32);

    /* CEK + NONCE step:
       CEK   = HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
       NONCE = HKDF(salt, ikm, "Content-Encoding: nonce\0",     12) */
    const cek   = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"),     12);

    /* Plaintext = payload || 0x02 (final record padding delimiter).
       0x02 marks "this is the last record"; intermediate records
       would use 0x01. Single-record messages = one 0x02 append.  */
    const plaintext = concat(payload, new Uint8Array([0x02]));

    const cekKey = await crypto.subtle.importKey(
        "raw", buf(cek), "AES-GCM", false, ["encrypt"]
    );
    const ctBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: buf(nonce) },
        cekKey,
        buf(plaintext)
    );
    const ciphertext = new Uint8Array(ctBuf);

    /* Record framing (RFC 8188 §2.1):
         16-byte salt
         4-byte record size (uint32 big-endian, payload+overhead cap)
         1-byte key id length (= 65 for the as_public uncompressed P-256)
         65-byte as_public
         ciphertext                                                 */
    const recSize = new Uint8Array(4);
    /* 4096 is the canonical Web Push record-size cap; we never
       exceed it because the payload limit at the push service is
       4 KB and aes128gcm overhead is 17 bytes. */
    new DataView(recSize.buffer).setUint32(0, 4096, false);

    return concat(
        salt,
        recSize,
        new Uint8Array([asPub.length]),  /* 65 */
        asPub,
        ciphertext
    );
}

/* ----- 4. Send to a single subscription endpoint ----- */

export interface PushSendResult {
    ok: boolean;
    status: number;
    /* True iff the push service told us the subscription is gone
       (404/410). Caller deletes the KV record on this signal.   */
    expired: boolean;
}

export async function sendPush(
    endpoint: string,
    keys:     PushKeys,
    payload:  Uint8Array,
    vapid:    VapidKeys,
    ttlSeconds = 3600
): Promise<PushSendResult> {
    const body = await encryptPayload(payload, keys);
    const auth = await vapidAuthorizationHeader(endpoint, vapid);

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type":     "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            "Content-Length":   String(body.length),
            "TTL":              String(ttlSeconds),
            "Urgency":          "normal",
            "Authorization":    auth
        },
        body: body as unknown as BodyInit
    });

    return {
        ok:      res.ok,
        status:  res.status,
        expired: res.status === 404 || res.status === 410
    };
}
