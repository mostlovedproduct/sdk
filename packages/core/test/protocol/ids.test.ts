import { describe, expect, it } from "vitest";
import { isUuidv7, uuidv7, uuidv7Timestamp } from "../../src/protocol/index.js";

describe("uuidv7", () => {
  it("produces canonical lowercase v7 ids", () => {
    for (let i = 0; i < 100; i++) {
      const id = uuidv7();
      expect(isUuidv7(id)).toBe(true);
      expect(id).toBe(id.toLowerCase());
    }
  });

  it("round-trips the timestamp", () => {
    const t = Date.UTC(2026, 10, 13, 23, 59, 59, 123);
    expect(uuidv7Timestamp(uuidv7(t + 10_000)).getTime()).toBe(t + 10_000);
    const now = Date.now();
    const ts = uuidv7Timestamp(uuidv7()).getTime();
    expect(Math.abs(ts - now)).toBeLessThan(1000);
  });

  it("is strictly increasing within a millisecond and across clock regressions", () => {
    const ids: string[] = [];
    const t = Date.now() + 60_000;
    for (let i = 0; i < 5000; i++) ids.push(uuidv7(t));
    ids.push(uuidv7(t - 5000));
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is time-ordered across milliseconds", () => {
    const base = Date.now() + 120_000;
    const a = uuidv7(base + 10);
    const b = uuidv7(base + 11);
    expect(b > a).toBe(true);
  });

  it("isUuidv7 rejects non-v7 and non-strings", () => {
    expect(isUuidv7("0190f3c4-8a8b-4c4d-8e8f-0123456789ab")).toBe(false);
    expect(isUuidv7(42)).toBe(false);
    expect(() => uuidv7Timestamp("nope")).toThrow(TypeError);
  });
});
