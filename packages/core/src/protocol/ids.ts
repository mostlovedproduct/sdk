/** UUIDv7 (RFC 9562): 48-bit unix ms timestamp, version 7, 12-bit counter, variant 10, 62 random bits. */

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Monotonic state (RFC 9562 method 1: 12-bit counter in rand_a, re-seeded each new millisecond).
let lastMs = -1;
let counter = 0;

/** Clock regressions up to this size keep IDs monotonic; larger ones (or explicit past times) are taken as given. */
const MAX_REGRESSION_MS = 10_000;

/**
 * New lowercase UUIDv7. IDs from one module instance are strictly increasing,
 * even within the same millisecond (the counter borrows the next ms on overflow)
 * and across small clock regressions (≤ 10 s).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ms = Math.floor(now);
  if (ms <= lastMs && lastMs - ms <= MAX_REGRESSION_MS) {
    ms = lastMs;
    counter++;
    if (counter > 0xfff) {
      ms++;
      counter = bytes[6]! & 0x07; // fresh seed, low enough to leave headroom
    }
  } else {
    counter = ((bytes[6]! & 0x07) << 8) | bytes[7]!; // top bit clear: ≥ 2048 increments of headroom
  }
  lastMs = ms;

  // 48-bit big-endian timestamp. Division keeps it exact beyond 2^32.
  const hi = Math.floor(ms / 0x1000000);
  const lo = ms % 0x1000000;
  bytes[0] = (hi >>> 16) & 0xff;
  bytes[1] = (hi >>> 8) & 0xff;
  bytes[2] = hi & 0xff;
  bytes[3] = (lo >>> 16) & 0xff;
  bytes[4] = (lo >>> 8) & 0xff;
  bytes[5] = lo & 0xff;
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  let h = "";
  for (const byte of bytes) h += byte.toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Canonical lowercase UUIDv7 with the RFC 9562 variant. Uppercase is rejected (IDs are storage keys). */
export function isUuidv7(value: unknown): value is string {
  return typeof value === "string" && UUIDV7_RE.test(value);
}

/** The timestamp encoded in a UUIDv7. Throws TypeError if `id` is not a UUIDv7. */
export function uuidv7Timestamp(id: string): Date {
  if (!isUuidv7(id)) throw new TypeError("Not a UUIDv7");
  const ms = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  return new Date(ms);
}
