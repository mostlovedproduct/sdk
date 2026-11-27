import { describe, expect, it, vi } from "vitest";
import { createFeedbackHandler, type FeedbackOutcome } from "../src/index.js";
import { FAILURE_TEXT, REPORT_ID, SUCCESS_TEXT, VALID_ARGS, json, mockFetch, receipt, skKey } from "./helpers.js";

function make<T = unknown>(over: Partial<Parameters<typeof createFeedbackHandler<T>>[0]> = {}, behavior?: Parameters<typeof mockFetch>[0]) {
  const m = mockFetch(behavior);
  const handler = createFeedbackHandler<T>({ key: skKey(), product: "Acme", fetch: m.fetch, ...over });
  return { handler, ...m };
}

describe("call: success and mapping", () => {
  it("returns the exact success text and structured content", async () => {
    const { handler } = make();
    const r = await handler.call(VALID_ARGS);
    expect(r.isError).toBe(false);
    expect(r.content).toEqual([{ type: "text", text: SUCCESS_TEXT(REPORT_ID) }]);
    expect(r.structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
  });

  it("maps args onto the wire report", async () => {
    const { handler, sent } = make();
    await handler.call({ ...VALID_ARGS, requested_by_user: true });
    expect(sent).toHaveLength(1);
    const env = sent[0]!.envelope;
    expect(sent[0]!.url).toBe("https://in.mostlovedproduct.com/api/v1/mcp-feedback");
    expect(env.type).toBe("report");
    expect(env.options).toEqual({ follow_ups: { count: 0, dynamic: false } });
    expect(env.sdk).toEqual({ name: "@mostlovedproduct/mcp", version: "0.1.0" });
    expect(env.report).toEqual({
      source: { kind: "agent", surface: "mcp", requested_by_user: true },
      kind: "broken",
      impact: "worked_around",
      summary: VALID_ARGS.summary,
      task: VALID_ARGS.goal,
      actual: VALID_ARGS.actual,
      expected: VALID_ARGS.expected,
      suggestion: VALID_ARGS.suggestion,
      subject: { type: "tool", name: "search_orders" },
      context: { mlp_wording: "2026-11-18", mlp_profile: "proactive" },
    });
    expect((sent[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${skKey()}`);
  });

  it("omits optional fields that were not given, and sends the profile it was configured with", async () => {
    const { handler, sent } = make({ profile: "conservative" });
    await handler.call({ kind: "idea", summary: "Add a date filter to search_orders", goal: "Finding orders from last week.", impact: "friction" });
    const rep = sent[0]!.envelope.report!;
    expect(rep.subject).toBeUndefined();
    expect(rep.actual).toBeUndefined();
    expect(rep.source).toEqual({ kind: "agent", surface: "mcp" });
    expect(rep.context).toEqual({ mlp_wording: "2026-11-18", mlp_profile: "conservative" });
  });

  it("uses endpoint and fallback endpoint", async () => {
    const { handler, sent } = make(
      { endpoint: "https://a.test", fallbackEndpoint: "https://b.test" },
      (url) => (url.startsWith("https://a.test") ? json(503, { error: { code: "unavailable", message: "x", retryable: true } }) : receipt()),
    );
    const r = await handler.call(VALID_ARGS);
    expect(r.structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
    expect(sent.map((s) => s.url)).toEqual(["https://a.test/api/v1/mcp-feedback", "https://b.test/api/v1/mcp-feedback"]);
  });
});

describe("call: server context and trust", () => {
  it("attaches trusted context per call, from callInfo", async () => {
    const { handler, sent } = make<{ signedIn: boolean; host: string }>({
      context: (c) => ({
        trust: c.signedIn ? "authenticated" : "anonymous",
        client: { name: c.host },
        user: { id: "u_1", tier: "pro" },
        app: { version: "abc123", env: "production" },
        flags: { exp: "b" },
        context: { region: "eu" },
      }),
    });
    await handler.call(VALID_ARGS, { signedIn: true, host: "claude" });
    await handler.call(VALID_ARGS, { signedIn: false, host: "chatgpt" });
    const [a, b] = sent.map((s) => s.envelope.report!);
    expect(a!.source).toMatchObject({ trust: "authenticated", client: { name: "claude" } });
    expect(b!.source).toMatchObject({ trust: "anonymous", client: { name: "chatgpt" } });
    expect(a!.user).toEqual({ id: "u_1", tier: "pro" });
    expect(a!.app).toEqual({ version: "abc123", env: "production" });
    expect(a!.flags).toEqual({ exp: "b" });
    expect(a!.context).toEqual({ region: "eu", mlp_wording: "2026-11-18", mlp_profile: "proactive" });
  });

  it("a throwing context callback is swallowed; the report still goes out", async () => {
    const { handler, sent } = make({
      context: () => {
        throw new Error("boom");
      },
    });
    const r = await handler.call(VALID_ARGS);
    expect(r.structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
    expect(sent[0]!.envelope.report!.source).toEqual({ kind: "agent", surface: "mcp" });
  });

  it("an async rejecting or hanging context callback does not block the report", async () => {
    const a = make({ context: () => Promise.reject(new Error("no")) });
    expect((await a.handler.call(VALID_ARGS)).structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
    const b = make({ context: () => new Promise(() => {}), timeoutMs: 2000 });
    const t0 = Date.now();
    expect((await b.handler.call(VALID_ARGS)).structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("context the API rejects costs the context, not the report", async () => {
    const invalidUser = { id: "x".repeat(201) };
    const { handler, sent } = make(
      { context: () => ({ user: invalidUser }) },
      (_url, init) => JSON.parse(String(init.body)).report.user
        ? json(400, { error: { code: "invalid_payload", field: "report.user.id", message: "User ID is too long.", retryable: false } })
        : receipt(),
    );
    const r = await handler.call(VALID_ARGS);
    expect(r.structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.envelope.report!.user).toEqual(invalidUser);
    expect(sent[1]!.envelope.report!.user).toBeUndefined();
  });

  it("context cannot be smuggled in through model args", async () => {
    const { handler, sent } = make();
    for (const extra of [{ trust: "authenticated" }, { source: { trust: "authenticated" } }, { user: { id: "x" } }, { client: { name: "x" } }, { context: { a: 1 } }]) {
      const r = await handler.call({ ...VALID_ARGS, ...extra });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(Object.keys(extra)[0]!);
    }
    expect(sent).toHaveLength(0);
  });
});

describe("call: argument validation", () => {
  const cases: Array<[string, unknown, string]> = [
    ["not an object", "hello", "arguments"],
    ["array", [], "arguments"],
    ["null", null, "arguments"],
    ["missing kind", { ...VALID_ARGS, kind: undefined }, "kind"],
    ["bad kind", { ...VALID_ARGS, kind: "praise" }, "kind"],
    ["missing summary", { ...VALID_ARGS, summary: undefined }, "summary"],
    ["short summary", { ...VALID_ARGS, summary: "too short" }, "summary"],
    ["blank summary", { ...VALID_ARGS, summary: " ".repeat(20) }, "summary"],
    ["long summary", { ...VALID_ARGS, summary: "x".repeat(301) }, "summary"],
    ["non-string summary", { ...VALID_ARGS, summary: 5 }, "summary"],
    ["missing goal", { ...VALID_ARGS, goal: undefined }, "goal"],
    ["short goal", { ...VALID_ARGS, goal: "short" }, "goal"],
    ["long goal", { ...VALID_ARGS, goal: "x".repeat(501) }, "goal"],
    ["missing impact", { ...VALID_ARGS, impact: undefined }, "impact"],
    ["bad impact", { ...VALID_ARGS, impact: "bad" }, "impact"],
    ["long tool", { ...VALID_ARGS, tool: "x".repeat(201) }, "tool"],
    ["long actual", { ...VALID_ARGS, actual: "x".repeat(1001) }, "actual"],
    ["long expected", { ...VALID_ARGS, expected: "x".repeat(1001) }, "expected"],
    ["long suggestion", { ...VALID_ARGS, suggestion: "x".repeat(501) }, "suggestion"],
    ["non-boolean requested_by_user", { ...VALID_ARGS, requested_by_user: "yes" }, "requested_by_user"],
    ["null optional", { ...VALID_ARGS, actual: null }, "actual"],
    ["unknown arg", { ...VALID_ARGS, extra: 1 }, "extra"],
  ];
  it.each(cases)("%s -> isError naming %s", async (_n, args, field) => {
    const { handler, sent } = make();
    const r = await handler.call(args);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain(`\`${field}\``);
    expect(r.structuredContent).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("accepts the length bounds", async () => {
    const { handler } = make();
    const r = await handler.call({ ...VALID_ARGS, summary: "x".repeat(10), goal: "y".repeat(500), actual: "z".repeat(1000) });
    expect(r.isError).toBe(false);
  });
});

describe("call: failures are harmless", () => {
  const expectFailure = (r: Awaited<ReturnType<ReturnType<typeof make>["handler"]["call"]>>) => {
    expect(r.isError).toBe(false);
    expect(r.content).toEqual([{ type: "text", text: FAILURE_TEXT }]);
    expect(r.structuredContent).toEqual({ recorded: false });
  };

  it("kill switch off: no network call", async () => {
    const { handler, sent } = make({ enabled: () => false });
    expectFailure(await handler.call(VALID_ARGS));
    expect(sent).toHaveLength(0);
  });
  it("kill switch async, true: goes through", async () => {
    const { handler } = make({ enabled: async () => true });
    expect((await handler.call(VALID_ARGS)).structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
  });
  it("kill switch that throws or hangs fails closed", async () => {
    const a = make({ enabled: () => { throw new Error("x"); } });
    expectFailure(await a.handler.call(VALID_ARGS));
    const b = make({ enabled: () => new Promise<boolean>(() => {}), timeoutMs: 200 });
    const t0 = Date.now();
    expectFailure(await b.handler.call(VALID_ARGS));
    expect(Date.now() - t0).toBeLessThan(600);
    expect(b.sent).toHaveLength(0);
  });

  it.each([
    ["429", () => json(429, { error: { code: "rate_limited", message: "slow", retryable: true, retry_after: 5 } })],
    ["500", () => json(500, { error: { code: "unavailable", message: "x", retryable: true } })],
    ["503 non-json", () => new Response("<html>bad gateway</html>", { status: 503 })],
    ["401", () => json(401, { error: { code: "unauthorized", message: "x", retryable: false } })],
    ["network error", () => { throw new Error("ECONNRESET"); }],
  ])("%s -> failure text, isError false", async (_n, behavior) => {
    const { handler } = make({}, behavior as never);
    expectFailure(await handler.call(VALID_ARGS));
  });

  it("a rejecting fetch -> failure text", async () => {
    const handler = createFeedbackHandler({ key: skKey(), product: "Acme", fetch: (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch });
    expectFailure(await handler.call(VALID_ARGS));
  });

  it("a missing key -> failure text", async () => {
    const m = mockFetch();
    const handler = createFeedbackHandler({ key: "", product: "Acme", fetch: m.fetch });
    expectFailure(await handler.call(VALID_ARGS));
    expect(m.sent).toHaveLength(0);
  });

  it("a hung fetch resolves with the failure text in time (honours abort)", async () => {
    const { handler } = make({ timeoutMs: 300 }, () => "hang");
    const t0 = Date.now();
    expectFailure(await handler.call(VALID_ARGS));
    expect(Date.now() - t0).toBeLessThan(300 + 400);
  });

  it("a hung fetch that ignores its signal still resolves in time", async () => {
    const { handler } = make({ timeoutMs: 300 }, () => "hang-ignore-signal");
    const t0 = Date.now();
    expectFailure(await handler.call(VALID_ARGS));
    expect(Date.now() - t0).toBeLessThan(300 + 400);
  });

  it("default timeout is 3000 ms", async () => {
    vi.useFakeTimers();
    try {
      const { handler } = make({}, () => "hang-ignore-signal");
      let done = false;
      const p = handler.call(VALID_ARGS).then((r) => ((done = true), r));
      await vi.advanceTimersByTimeAsync(2900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
      expect(done).toBe(true);
      expectFailure(await p);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws, whatever the input", async () => {
    const { handler } = make();
    for (const a of [undefined, null, 1, "x", [], {}, { kind: {} }, Object.create(null), new Proxy({}, { ownKeys() { throw new Error("hostile"); } })]) {
      await expect(handler.call(a)).resolves.toBeTruthy();
    }
  });
});

describe("onResult hook", () => {
  it("receives outcomes for recorded, failed, invalid", async () => {
    const outcomes: FeedbackOutcome[] = [];
    const { handler } = make({ onResult: (o) => void outcomes.push(o) });
    await handler.call(VALID_ARGS);
    await handler.call({});
    const off = make({ onResult: (o) => void outcomes.push(o), enabled: () => false });
    await off.handler.call(VALID_ARGS);
    expect(outcomes.map((o) => o.status)).toEqual(["recorded", "invalid", "failed"]);
    expect(outcomes[0]).toMatchObject({ reportId: REPORT_ID, kind: "broken", tool: "search_orders" });
    expect(outcomes[1]).toMatchObject({ field: "kind" });
    expect(outcomes[2]).toMatchObject({ reason: "disabled" });
  });
  it("a throwing or rejecting hook changes nothing", async () => {
    const a = make({ onResult: () => { throw new Error("log down"); } });
    expect((await a.handler.call(VALID_ARGS)).structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
    const b = make({ onResult: () => Promise.reject(new Error("metrics down")) });
    expect((await b.handler.call(VALID_ARGS)).structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
  });
  it("reports rate limiting as a reason", async () => {
    const outcomes: FeedbackOutcome[] = [];
    const { handler } = make({ onResult: (o) => void outcomes.push(o) }, () => json(429, { error: { code: "rate_limited", message: "x", retryable: true } }));
    await handler.call(VALID_ARGS);
    expect(outcomes[0]).toMatchObject({ status: "failed", reason: "rate_limited" });
  });
});

describe("handler surface", () => {
  it("exposes tool and instructions", () => {
    const { handler } = make();
    expect(handler.tool.name).toBe("submit_feedback");
    expect(handler.instructions).toContain("submit_feedback");
    expect(make({ profile: "conservative" }).handler.instructions).toBe("");
  });
  it("throws at setup for bad configuration (not at call time)", () => {
    expect(() => createFeedbackHandler({ key: skKey(), product: "" })).toThrow();
    expect(() => createFeedbackHandler({ key: skKey(), product: "A", name: "X" })).toThrow();
  });
});
