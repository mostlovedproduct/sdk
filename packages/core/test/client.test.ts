import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_PATHS, CAPTURE_STREAM_TYPE, captureFrame, isUuidv7, type Envelope, type Receipt } from "../src/protocol/index.js";
import { createClient, type ClientConfig, type SubmitFailure, type SubmitResult } from "../src/index.js";

const PRIMARY = "https://in.test";
const FALLBACK = "https://fallback.test";
const key = "opaque-test-key";

afterEach(() => {
  vi.useRealTimers();
});

type Handler = (url: string, init: RequestInit) => Response | Promise<Response> | "hang" | "hang-ignore-signal";

interface Call {
  url: string;
  init: RequestInit;
  body: Envelope;
  raw: string;
  signal: AbortSignal;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const R1 = "01900000-0000-7000-8000-000000000001";

function receipt(over: Partial<Receipt> = {}): Response {
  return json(202, { report_id: R1, status: "captured", duplicate: false, message: "Thanks!", ...over });
}

function errorBody(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return json(status, { error: { code, message: `${code} happened`, retryable: status >= 500 || status === 429, ...extra } });
}

function mockFetch(...handlers: Handler[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const raw = String(init?.body);
    const signal = init!.signal!;
    calls.push({ url, init: init!, raw, body: JSON.parse(raw), signal });
    const h = handlers[Math.min(i++, handlers.length - 1)]!;
    const r = await h(url, init!);
    if (r === "hang-ignore-signal") return new Promise<Response>(() => {});
    if (r === "hang") {
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    if (url.endsWith(CAPTURE_PATHS.userFeedback) && r.ok && r.headers.get("Content-Type") === "application/json") {
      const { follow_up, ...saved } = await r.json() as Receipt;
      return new Response(new Blob([captureFrame("captured", saved), ...(follow_up ? [captureFrame("follow_up", follow_up)] : [])]), {
        status: r.status, headers: { "Content-Type": CAPTURE_STREAM_TYPE },
      });
    }
    return r;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function client(fetchImpl: typeof fetch, extra: Partial<ClientConfig> = {}) {
  return createClient({ key, endpoint: PRIMARY, fetch: fetchImpl, ...extra });
}

const input = { summary: "The export button does nothing" };

describe("submit: happy path", () => {
  it("sends a valid envelope and resolves ok", async () => {
    const m = mockFetch(() => receipt({ report_id: "will-be-used" }));
    const res = await client(m.fetch).submit(input);
    expect(res).toEqual({ ok: true, reportId: "will-be-used", duplicate: false, message: "Thanks!" });
    expect(m.calls).toHaveLength(1);
    const c = m.calls[0]!;
    expect(c.url).toBe(`${PRIMARY}/api/v1/user-feedback`);
    expect(c.init.method).toBe("POST");
    expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
    expect((c.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(c.url).not.toContain(key);
    expect(c.body.v).toBe(1);
    expect(Date.parse(c.body.sent_at)).not.toBeNaN();
    expect(isUuidv7(c.body.id)).toBe(true);
    expect(c.body.type).toBe("report");
    expect(c.body.sdk).toEqual({ name: "@mostlovedproduct/core", version: expect.any(String) });
    expect(c.body.report).toEqual({ summary: input.summary, source: { kind: "human", surface: "api" } });
    expect(c.body.options).toBeUndefined();
  });

  it("rejects a success response without a capture stream", async () => {
    const m = mockFetch(() => new Response("", { status: 202 }));
    const res = await client(m.fetch).submit(input);
    expect(res).toMatchObject({ ok: false, error: { code: "network" } });
  });

  it("acknowledges capture before the follow-up and never fails over after receipt", async () => {
    const saved = vi.fn();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const m = mockFetch(() => new Response(new ReadableStream({ start: (controller) => { stream = controller; } }), {
      status: 202, headers: { "Content-Type": CAPTURE_STREAM_TYPE },
    }));
    const pending = client(m.fetch, { fallbackEndpoint: FALLBACK, onCaptured: saved }).submit(input);
    stream.enqueue(captureFrame("captured", { report_id: R1, status: "captured", duplicate: false, message: "Saved" }));
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith({ ok: true, reportId: R1, duplicate: false, message: "Saved" }));
    stream.error(new Error("Interrupted after capture"));
    await expect(pending).resolves.toMatchObject({ ok: true, reportId: R1 });
    expect(m.calls).toHaveLength(1);
  });

  it("reports duplicates", async () => {
    const m = mockFetch(() => receipt({ duplicate: true }));
    expect(await client(m.fetch).submit(input)).toMatchObject({ ok: true, duplicate: true });
  });

  it("sends follow_ups from config or per call, and sdk/source overrides", async () => {
    const m = mockFetch(() => receipt());
    const c = client(m.fetch, {
      followUps: 2,
      sdk: { name: "@mostlovedproduct/web", version: "1.0.0" },
      source: { surface: "web", client: { name: "Firefox" } },
    });
    await c.submit(input);
    await c.submit({ ...input, source: { kind: "agent", surface: "mcp" } }, { followUps: 0 });
    expect(m.calls[0]!.body.options).toEqual({ follow_ups: { count: 2, dynamic: false } });
    expect(m.calls[0]!.body.sdk).toEqual({ name: "@mostlovedproduct/web", version: "1.0.0" });
    expect(m.calls[0]!.body.report!.source).toEqual({ kind: "human", surface: "web", client: { name: "Firefox" } });
    expect(m.calls[1]!.body.options).toEqual({ follow_ups: { count: 0, dynamic: false } });
    expect(m.calls[1]!.body.report!.source).toEqual({ kind: "agent", surface: "mcp", client: { name: "Firefox" } });
  });

  it("generates a new id per submit", async () => {
    const m = mockFetch(() => receipt());
    const c = client(m.fetch);
    await c.submit(input);
    await c.submit(input);
    expect(m.calls[0]!.body.id).not.toBe(m.calls[1]!.body.id);
  });
});

describe("submit: errors", () => {
  it.each([
    [400, "invalid_payload", false],
    [401, "unauthorized", false],
    [403, "forbidden_origin", false],
    [409, "conflict", false],
    [410, "follow_up_expired", false],
    [413, "payload_too_large", false],
    [429, "rate_limited", true],
  ])("%i → %s without failover", async (status, code, retryable) => {
    const m = mockFetch(() => errorBody(status, code, { field: "report.summary", retry_after: 7 }));
    const res = await client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input);
    const { retry, ...rest } = res as SubmitFailure;
    expect(rest).toEqual({
      ok: false,
      error: { code, message: `${code} happened`, retryable, status, field: "report.summary", retryAfter: 7 },
    });
    // Only transient failures can be resent as is.
    expect(typeof retry).toBe(code === "rate_limited" ? "function" : "undefined");
    expect(m.calls).toHaveLength(1);
  });

  it("maps status when the error body is missing", async () => {
    const m = mockFetch(() => new Response("nope", { status: 401 }));
    expect(await client(m.fetch).submit(input)).toMatchObject({ ok: false, error: { code: "unauthorized", status: 401, retryable: false } });
  });

  it("5xx → unavailable when there is no fallback", async () => {
    const m = mockFetch(() => errorBody(503, "unavailable"));
    expect(await client(m.fetch).submit(input)).toMatchObject({ ok: false, error: { code: "unavailable", status: 503, retryable: true } });
  });

  it("network error → network", async () => {
    const m = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await client(m.fetch).submit(input)).toMatchObject({ ok: false, error: { code: "network", retryable: true } });
  });

  it("rejects a missing key locally", async () => {
    const m = mockFetch(() => receipt());
    expect(await createClient({ key: "", fetch: m.fetch }).submit(input)).toMatchObject({
      ok: false,
      error: { code: "invalid_input", field: "key", retryable: false },
    });
    expect(m.calls).toHaveLength(0);
  });

  it("sends opaque keys and lets intake reject invalid credentials", async () => {
    const m = mockFetch(() => errorBody(401, "unauthorized"));
    const result = await client(m.fetch).submit(input);
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized", status: 401 } });
    expect(m.calls[0]!.init.headers).toMatchObject({ Authorization: `Bearer ${key}` });
  });

  it("catches missing report text and oversized requests locally", async () => {
    const m = mockFetch(() => receipt());
    const c = client(m.fetch);
    expect(await c.submit({ summary: "" })).toMatchObject({ ok: false, error: { code: "invalid_input", field: "summary" } });
    expect(await c.submit({ summary: "😀".repeat(301) })).toMatchObject({ ok: false, error: { code: "invalid_input", field: "summary" } });
    const context = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, "y".repeat(900)]));
    expect(await c.submit({ ...input, context })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await c.submit(null as never)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(m.calls).toHaveLength(0);
  });

  it("returns the intake validator's error and field", async () => {
    const m = mockFetch(() => errorBody(400, "invalid_payload", { field: "report.kind" }));
    const result = await client(m.fetch).submit({ ...input, kind: "bug" as never });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_payload", field: "report.kind", status: 400 } });
    expect(m.calls).toHaveLength(1);
  });

  it("never rejects, even with a hostile fetch and config", async () => {
    const throwingSync = (() => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(client(throwingSync).submit(input)).resolves.toMatchObject({ ok: false, error: { code: "network" } });
    const badResponse = (async () => ({ status: 202 })) as unknown as typeof fetch;
    await expect(client(badResponse).submit(input)).resolves.toMatchObject({ ok: false });
    await expect(createClient(undefined as never).submit(input)).resolves.toMatchObject({ ok: false });
  });
});

describe("submit: failover", () => {
  it("5xx → fallback success, identical body", async () => {
    const m = mockFetch(() => errorBody(502, "unavailable"), () => receipt({ report_id: "from-fallback" }));
    const res = await client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input);
    expect(res).toMatchObject({ ok: true, reportId: "from-fallback" });
    expect(m.calls.map((c) => c.url)).toEqual([`${PRIMARY}/api/v1/user-feedback`, `${FALLBACK}/api/v1/user-feedback`]);
    expect(m.calls[1]!.raw).toBe(m.calls[0]!.raw);
  });

  it("network error → fallback success", async () => {
    const m = mockFetch(
      () => {
        throw new TypeError("connection refused");
      },
      () => receipt(),
    );
    expect(await client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input)).toMatchObject({ ok: true });
    expect(m.calls[1]!.raw).toBe(m.calls[0]!.raw);
  });

  it("timeout → fallback success within the deadline", async () => {
    vi.useFakeTimers();
    const m = mockFetch(() => "hang", () => receipt());
    const p = client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input);
    await vi.advanceTimersByTimeAsync(2500);
    const res = await p;
    expect(res).toMatchObject({ ok: true });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]!.signal.aborted).toBe(true);
    expect(m.calls[1]!.raw).toBe(m.calls[0]!.raw);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("both fail → the fallback's error, at most one attempt each", async () => {
    const m = mockFetch(() => errorBody(500, "unavailable"), () => errorBody(503, "unavailable", { message: "fallback down" }));
    const res = await client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input);
    expect(res).toMatchObject({ ok: false, error: { code: "unavailable", status: 503, message: "fallback down" } });
    expect(m.calls).toHaveLength(2);
  });

  it("4xx from the fallback is returned as is", async () => {
    const m = mockFetch(() => errorBody(500, "unavailable"), () => errorBody(409, "conflict"));
    expect(await client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input)).toMatchObject({ ok: false, error: { code: "conflict" } });
  });
});

describe("submit: deadline arithmetic", () => {
  it("reserves 1.5 s for the fallback out of the 4 s default", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const m = mockFetch(() => "hang", () => "hang");
    const p = client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input);
    await vi.advanceTimersByTimeAsync(2499);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.calls[0]!.signal.aborted).toBe(true);
    expect(m.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(m.calls[1]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ ok: false, error: { code: "timeout", retryable: true } });
    expect(Date.now()).toBe(1_004_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives the fallback whatever is left when the primary fails fast", async () => {
    vi.useFakeTimers({ now: 0 });
    const m = mockFetch(
      async () => {
        await new Promise((r) => setTimeout(r, 100));
        return errorBody(503, "unavailable");
      },
      () => "hang",
    );
    const p = client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input);
    await vi.advanceTimersByTimeAsync(3999); // primary failed at 100 ms; the fallback gets the remaining 3900
    expect(m.calls[1]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ ok: false, error: { code: "timeout" } });
  });

  it("uses the whole budget without a fallback, and honours timeoutMs", async () => {
    vi.useFakeTimers({ now: 0 });
    const m = mockFetch(() => "hang");
    const p = client(m.fetch, { timeoutMs: 1000 }).submit(input);
    await vi.advanceTimersByTimeAsync(999);
    expect(m.calls[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ ok: false, error: { code: "timeout" } });
  });

  it("splits a small budget evenly", async () => {
    vi.useFakeTimers({ now: 0 });
    const m = mockFetch(() => "hang", () => "hang");
    const p = client(m.fetch, { timeoutMs: 2000, fallbackEndpoint: FALLBACK }).submit(input);
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ ok: false, error: { code: "timeout" } });
  });

  it("enforces the deadline even when fetch ignores its signal", async () => {
    vi.useFakeTimers({ now: 0 });
    const m = mockFetch(() => "hang-ignore-signal");
    const p = client(m.fetch, { timeoutMs: 1000 }).submit(input);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops on caller abort without failover", async () => {
    const m = mockFetch(() => "hang", () => receipt());
    const ac = new AbortController();
    const p = client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input, { signal: ac.signal });
    await Promise.resolve();
    ac.abort();
    expect(await p).toMatchObject({ ok: false, error: { code: "network", retryable: false } });
    expect(m.calls).toHaveLength(1);
    const already = await client(m.fetch).submit(input, { signal: ac.signal });
    expect(already).toMatchObject({ ok: false });
    expect(m.calls).toHaveLength(1);
  });
});

describe("submit: hooks and context", () => {
  it("beforeSend can mutate", async () => {
    const m = mockFetch(() => receipt());
    await client(m.fetch, { beforeSend: (r) => ({ ...r, summary: "rewritten" }) }).submit(input);
    expect(m.calls[0]!.body.report!.summary).toBe("rewritten");
  });

  it("beforeSend null → dropped, nothing sent", async () => {
    const m = mockFetch(() => receipt());
    expect(await client(m.fetch, { beforeSend: async () => null }).submit(input)).toMatchObject({
      ok: false,
      error: { code: "dropped", retryable: false },
    });
    expect(m.calls).toHaveLength(0);
  });

  it("beforeSend throwing (sync or async) or returning junk → dropped", async () => {
    const m = mockFetch(() => receipt());
    for (const beforeSend of [
      () => {
        throw new Error("x");
      },
      async () => {
        throw new Error("x");
      },
      () => undefined as never,
    ]) {
      expect(await client(m.fetch, { beforeSend }).submit(input)).toMatchObject({ ok: false, error: { code: "dropped" } });
    }
    expect(m.calls).toHaveLength(0);
  });

  it("beforeSend that never settles → timeout at the deadline", async () => {
    vi.useFakeTimers({ now: 0 });
    const m = mockFetch(() => receipt());
    const p = client(m.fetch, { beforeSend: () => new Promise(() => {}) }).submit(input);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("getContext throwing, rejecting or hanging is ignored", async () => {
    vi.useFakeTimers({ now: 0 });
    const m = mockFetch(() => receipt());
    for (const getContext of [
      () => {
        throw new Error("x");
      },
      () => Promise.reject(new Error("x")),
      () => new Promise<never>(() => {}),
    ]) {
      const p = client(m.fetch, { getContext, context: { a: 1 } }).submit(input);
      await vi.advanceTimersByTimeAsync(500);
      expect(await p).toMatchObject({ ok: true });
    }
    expect(m.calls.map((c) => c.body.report!.context)).toEqual([{ a: 1 }, { a: 1 }, { a: 1 }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("merges static < setX < getContext < input", async () => {
    const m = mockFetch(() => receipt());
    const c = client(m.fetch, {
      user: { id: "static", tier: "free", traits: { a: 1, b: 1 } },
      flags: { f1: "static", f2: true },
      app: { version: "1", env: "prod" },
      context: { s: 1, x: "static" },
      getContext: async () => ({ context: { x: "getContext", g: true }, page: { path: "/p" }, user: { traits: { b: 3 } } }),
    });
    c.setUser({ tier: "pro", traits: { b: 2, c: 2 } });
    c.setFlags({ f2: false, f3: "set" });
    c.setApp({ version: "2" });
    c.setContext({ x: "set", y: 1 });
    await c.submit({ ...input, context: { x: "input" }, flags: { f3: "input" }, app: { release: "r" } });
    expect(m.calls[0]!.body.report).toMatchObject({
      user: { id: "static", tier: "pro", traits: { a: 1, b: 3, c: 2 } },
      flags: { f1: "static", f2: false, f3: "input" },
      app: { version: "2", env: "prod", release: "r" },
      context: { s: 1, x: "input", y: 1, g: true },
      page: { path: "/p" },
    });
    c.setUser(null);
    await c.submit(input);
    expect(m.calls[1]!.body.report!.user).toEqual({ traits: { b: 3 } }); // only getContext's part is left
  });

  it("redacts before send (on by default, configurable, can be disabled)", async () => {
    const m = mockFetch(() => receipt());
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    await client(m.fetch).submit({ summary: `Broken with ${secret}`, contact: { email: "a@b.co" }, details: "mail a@b.co" });
    expect(m.calls[0]!.raw).not.toContain(secret);
    expect(m.calls[0]!.body.report!.summary).toBe("Broken with [redacted:github_token]");
    expect(m.calls[0]!.body.report!.details).toBe("mail a@b.co");
    await client(m.fetch, { redact: { emails: true, patterns: [/ORD-\d+/] } }).submit({ summary: "ORD-1 a@b.co", contact: { email: "a@b.co" } });
    expect(m.calls[1]!.body.report!.summary).toBe("[redacted:custom] [redacted:email]");
    expect(m.calls[1]!.body.report!.contact).toEqual({ email: "a@b.co" });
    await client(m.fetch, { redact: false }).submit({ summary: secret });
    expect(m.calls[2]!.body.report!.summary).toBe(secret);
  });

  it("redacts what beforeSend adds", async () => {
    const m = mockFetch(() => receipt());
    await client(m.fetch, { beforeSend: (r) => ({ ...r, details: "password=hunter2" }) }).submit(input);
    expect(m.calls[0]!.body.report!.details).toBe("password=[redacted:secret]");
  });

  it("keeps no global state between clients", async () => {
    const m = mockFetch(() => receipt());
    const a = client(m.fetch);
    const b = client(m.fetch);
    a.setContext({ only: "a" });
    await b.submit(input);
    expect(m.calls[0]!.body.report!.context).toBeUndefined();
  });
});

describe("follow-ups", () => {
  const followUp = (over: Record<string, unknown> = {}) => ({
    id: "impact",
    question: "How much did this get in your way?",
    input: "choice",
    options: [
      { id: "blocked", label: "It stopped me" },
      { id: "friction", label: "Minor annoyance" },
    ],
    reply_token: "TOKEN1",
    expires_at: "2026-11-13T12:30:00.000Z",
    ...over,
  });

  it("answers a choice, gets a second follow-up, and skips it", async () => {
    const m = mockFetch(
      () => receipt({ report_id: R1, follow_up: followUp() as never }),
      () =>
        json(202, {
          report_id: R1,
          status: "captured",
          duplicate: false,
          message: "Thanks",
          follow_up: followUp({ id: "expected", input: "text", options: undefined, reply_token: "TOKEN2" }),
        }),
      () => json(202, { report_id: R1, status: "captured", duplicate: false, message: "Done" }),
    );
    const res = await client(m.fetch, { followUps: 2 }).submit(input);
    if (!res.ok || !res.followUp) throw new Error("expected a follow-up");
    expect(res.followUp).toMatchObject({
      id: "impact",
      input: "choice",
      question: "How much did this get in your way?",
      expiresAt: "2026-11-13T12:30:00.000Z",
      options: [
        { id: "blocked", label: "It stopped me" },
        { id: "friction", label: "Minor annoyance" },
      ],
    });

    const r2 = await res.followUp.answer({ optionId: "blocked" });
    const a = m.calls[1]!;
    expect(a.url).toBe(`${PRIMARY}/api/v1/user-feedback/answers`);
    expect(a.body.v).toBe(1);
    expect(isUuidv7(a.body.id)).toBe(true);
    expect(a.body.type).toBe("answer");
    expect(a.body.id).not.toBe(m.calls[0]!.body.id);
    expect(a.body.answer).toEqual({ report_id: R1, follow_up_id: "impact", reply_token: "TOKEN1", option_id: "blocked" });
    if (!r2.ok || !r2.followUp) throw new Error("expected a second follow-up");
    expect(r2.followUp.id).toBe("expected");

    const r3 = await r2.followUp.skip();
    expect(r3).toEqual({ ok: true, reportId: R1, duplicate: false, message: "Done" });
    expect(m.calls[2]!.body.answer).toEqual({ report_id: R1, follow_up_id: "expected", reply_token: "TOKEN2", skipped: true });
  });

  it("validates answers locally and redacts text answers", async () => {
    const m = mockFetch(
      () => receipt({ follow_up: followUp() as never }),
      () => receipt({ follow_up: followUp({ id: "task", input: "text", options: undefined }) as never }),
      () => receipt(),
    );
    const res = await client(m.fetch).submit(input);
    if (!res.ok || !res.followUp) throw new Error("expected a follow-up");
    expect(await res.followUp.answer({ optionId: "nope" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await res.followUp.answer({ text: "x" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const r2 = await res.followUp.answer({ optionId: "friction" });
    if (!r2.ok || !r2.followUp) throw new Error("expected a second follow-up");
    expect(await r2.followUp.answer({ text: "  " })).toMatchObject({ ok: false, error: { field: "text" } });
    await r2.followUp.answer({ text: "Export with token=abc" });
    expect(m.calls[2]!.body.answer!.text).toBe("Export with token=[redacted:secret]");
  });

  it("answers once: repeated calls return the settled result", async () => {
    const m = mockFetch(() => receipt({ follow_up: followUp() as never }), () => receipt({ message: "once" }));
    const res = await client(m.fetch).submit(input);
    if (!res.ok || !res.followUp) throw new Error("expected a follow-up");
    const [a, b] = await Promise.all([res.followUp.answer({ optionId: "blocked" }), res.followUp.skip()]);
    expect(a).toBe(b);
    expect(await res.followUp.skip()).toBe(a);
    expect(m.calls).toHaveLength(2);
  });

  it("sends answers to the endpoint that accepted the report first, failing over to the other", async () => {
    const m = mockFetch(
      () => errorBody(503, "unavailable"),
      () => receipt({ follow_up: followUp() as never }),
      () => errorBody(503, "unavailable"),
      () => receipt({ message: "answered" }),
    );
    const res = await client(m.fetch, { fallbackEndpoint: FALLBACK }).submit(input);
    if (!res.ok || !res.followUp) throw new Error("expected a follow-up");
    expect(await res.followUp.answer({ optionId: "blocked" })).toMatchObject({ ok: true, message: "answered" });
    expect(m.calls.map((c) => c.url)).toEqual([
      `${PRIMARY}/api/v1/user-feedback`,
      `${FALLBACK}/api/v1/user-feedback`,
      `${FALLBACK}/api/v1/user-feedback/answers`,
      `${PRIMARY}/api/v1/user-feedback/answers`,
    ]);
    expect(m.calls[3]!.raw).toBe(m.calls[2]!.raw);
  });

  it("surfaces follow_up_expired", async () => {
    const m = mockFetch(() => receipt({ follow_up: followUp() as never }), () => errorBody(410, "follow_up_expired"));
    const res = await client(m.fetch).submit(input);
    if (!res.ok || !res.followUp) throw new Error("expected a follow-up");
    expect(await res.followUp.skip()).toMatchObject({ ok: false, error: { code: "follow_up_expired", status: 410 } });
  });

  it("ignores a malformed follow_up", async () => {
    const m = mockFetch(() => receipt({ follow_up: { id: "nope" } as never }));
    const res = await client(m.fetch).submit(input);
    expect(res.ok && res.followUp).toBeFalsy();
  });
});

describe("retry: idempotent resend", () => {
  it("timeout → retry() resends the byte-identical body with a fresh deadline; duplicate is success", async () => {
    vi.useFakeTimers({ now: 0 });
    let calls = 0;
    const getContext = vi.fn(() => ({ context: { n: ++calls } }));
    const beforeSend = vi.fn((r) => r);
    const m = mockFetch(() => "hang", () => receipt({ duplicate: true }));
    const c = client(m.fetch, { getContext, beforeSend });
    const p = c.submit({ summary: "Broken ghp_abcdefghijklmnopqrstuvwxyz0123456789" });
    await vi.advanceTimersByTimeAsync(4000);
    const first = (await p) as SubmitFailure;
    expect(first).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(typeof first.retry).toBe("function");

    await vi.advanceTimersByTimeAsync(60_000); // much later: sent_at must not change
    const second = await first.retry!();
    expect(second).toEqual({ ok: true, reportId: R1, duplicate: true, message: "Thanks!" });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]!.raw).toBe(m.calls[0]!.raw);
    expect(m.calls[1]!.url).toBe(m.calls[0]!.url);
    // Nothing was re-run: same context, hooks once, redaction already in the body.
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(m.calls[1]!.raw).not.toContain("ghp_");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retry gets its own full deadline and failover, and chains on repeated failure", async () => {
    vi.useFakeTimers({ now: 0 });
    const m = mockFetch(
      () => {
        throw new TypeError("offline");
      },
      () => errorBody(503, "unavailable"),
      () => "hang",
      () => receipt(),
    );
    const c = client(m.fetch, { fallbackEndpoint: FALLBACK });
    const first = (await c.submit(input)) as SubmitFailure;
    expect(first.error.code).toBe("unavailable");
    const p = first.retry!();
    await vi.advanceTimersByTimeAsync(2500); // primary budget = 4000 − 1500
    const second = await p;
    expect(second).toMatchObject({ ok: true, reportId: R1 });
    expect(m.calls.map((x) => x.url)).toEqual([
      `${PRIMARY}/api/v1/user-feedback`,
      `${FALLBACK}/api/v1/user-feedback`,
      `${PRIMARY}/api/v1/user-feedback`,
      `${FALLBACK}/api/v1/user-feedback`,
    ]);
    expect(new Set(m.calls.map((x) => x.raw)).size).toBe(1);
  });

  it("a failed retry carries retry() again; network and 429 are resendable, 4xx and local errors are not", async () => {
    const m = mockFetch(
      () => {
        throw new TypeError("offline");
      },
      () => errorBody(429, "rate_limited"),
      () => errorBody(400, "invalid_payload", { field: "report.context.x" }),
    );
    const c = client(m.fetch);
    const a = (await c.submit(input)) as SubmitFailure;
    expect(a.error.code).toBe("network");
    const b = (await a.retry!()) as SubmitFailure;
    expect(b.error.code).toBe("rate_limited");
    const d = (await b.retry!()) as SubmitFailure;
    expect(d).toMatchObject({ ok: false, error: { code: "invalid_payload", field: "report.context.x" } });
    expect(d.retry).toBeUndefined();
    expect(new Set(m.calls.map((x) => x.raw)).size).toBe(1);
    const local = (await c.submit({ summary: "" })) as SubmitFailure;
    expect(local.retry).toBeUndefined();
  });

  it("a new submit() is a new report (new id)", async () => {
    const m = mockFetch(() => {
      throw new TypeError("offline");
    });
    const c = client(m.fetch);
    await c.submit(input);
    await c.submit(input);
    expect(m.calls[0]!.body.id).not.toBe(m.calls[1]!.body.id);
  });

  it("retry honours a caller signal", async () => {
    const m = mockFetch(
      () => {
        throw new TypeError("offline");
      },
      () => "hang",
    );
    const first = (await client(m.fetch).submit(input)) as SubmitFailure;
    const ac = new AbortController();
    const p = first.retry!({ signal: ac.signal });
    ac.abort();
    expect(await p).toMatchObject({ ok: false, error: { code: "network", retryable: false } });
  });

  it("failed answers can be resent identically too", async () => {
    const m = mockFetch(
      () =>
        receipt({
          follow_up: { id: "task", question: "Q", input: "text", reply_token: "T", expires_at: "2030-01-01T00:00:00Z" },
        }),
      () => {
        throw new TypeError("offline");
      },
      () => receipt({ duplicate: true, message: "answered" }),
    );
    const res = await client(m.fetch).submit(input);
    if (!res.ok || !res.followUp) throw new Error("expected follow-up");
    const a = (await res.followUp.answer({ text: "export" })) as SubmitFailure;
    expect(a.error.code).toBe("network");
    const b = await a.retry!();
    expect(b).toMatchObject({ ok: true, duplicate: true, message: "answered" });
    expect(m.calls[2]!.raw).toBe(m.calls[1]!.raw);
    // The handle is settled by the successful retry.
    expect(await res.followUp.skip()).toBe(b);
  });
});

describe("page URL stripping (contract section 5)", () => {
  const page = { url: "https://app.test/a?tab=1#frag", referrer: "https://ref.test/r?q=2#x", path: "/a", title: "T" };

  it("drops query and fragment from page.url and page.referrer from every source", async () => {
    const m = mockFetch(() => receipt());
    await client(m.fetch, { page }).submit(input);
    await client(m.fetch, { getContext: () => ({ page }) }).submit(input);
    await client(m.fetch).submit({ ...input, page });
    for (const c of m.calls) {
      expect(c.body.report!.page).toEqual({ url: "https://app.test/a", referrer: "https://ref.test/r", path: "/a", title: "T" });
    }
  });

  it("keepUrl opts in to the query, the fragment or both", async () => {
    const m = mockFetch(() => receipt());
    await client(m.fetch, { page, keepUrl: true }).submit(input);
    await client(m.fetch, { page, keepUrl: { query: true } }).submit(input);
    await client(m.fetch, { page, keepUrl: { hash: true } }).submit(input);
    expect(m.calls.map((c) => c.body.report!.page!.url)).toEqual([
      "https://app.test/a?tab=1#frag",
      "https://app.test/a?tab=1",
      "https://app.test/a#frag",
    ]);
    expect(m.calls[1]!.body.report!.page!.referrer).toBe("https://ref.test/r?q=2");
  });
});

describe("getContext isolation", () => {
  it("a slow or throwing getContext drops only its own contribution", async () => {
    vi.useFakeTimers({ now: 0 });
    for (const bad of [() => new Promise<never>(() => {}), () => Promise.reject(new Error("x")), () => {
      throw new Error("x");
    }]) {
      const m = mockFetch(() => receipt());
      const c = client(m.fetch, {
        user: { id: "u1" },
        flags: { f: "static" },
        app: { version: "1" },
        page: { path: "/static" },
        context: { s: 1 },
        getContext: [bad, () => ({ context: { good: true } })],
      });
      c.setContext({ set: 2 });
      c.setFlags({ g: true });
      const p = c.submit({ ...input, kind: "broken", context: { inp: 3 }, app: { release: "r" } });
      await vi.advanceTimersByTimeAsync(500);
      expect(await p).toMatchObject({ ok: true });
      expect(m.calls[0]!.body.report).toMatchObject({
        kind: "broken",
        user: { id: "u1" },
        flags: { f: "static", g: true },
        app: { version: "1", release: "r" },
        page: { path: "/static" },
        context: { s: 1, set: 2, good: true, inp: 3 },
      });
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("providers run in parallel and later ones win", async () => {
    vi.useFakeTimers({ now: 0 });
    const m = mockFetch(() => receipt());
    const later = (v: string, ms: number) => () => new Promise<{ context: { x: string } }>((r) => setTimeout(() => r({ context: { x: v } }), ms));
    const p = client(m.fetch, { getContext: [later("first", 400), later("second", 300)] }).submit(input);
    await vi.advanceTimersByTimeAsync(400);
    expect(await p).toMatchObject({ ok: true });
    expect(m.calls[0]!.body.report!.context).toEqual({ x: "second" });
  });
});
