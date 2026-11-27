import { CAPTURE_STREAM_TYPE, captureFrame } from "@mostlovedproduct/core/protocol";
import { describe, expect, it, vi } from "vitest";
import { createFeedback } from "../src/controller.js";
import { cleanProps, collectPage, splitText } from "../src/context.js";
import type { ControllerConfig, FeedbackStatus } from "../src/types.js";
import { KEY, followUp, mockFetch, tick, withFollowUp } from "./helpers.js";

function make(extra: Partial<ControllerConfig> = {}, ...replies: Parameters<typeof mockFetch>) {
  const m = mockFetch(...(replies.length ? replies : [{}]));
  const c = createFeedback({ key: KEY, endpoint: "https://in.test", fetch: m.fetch, ...extra });
  const seen: FeedbackStatus[] = [];
  c.subscribe((s) => seen.push(s.status));
  return { c, ...m, seen };
}

describe("state machine", () => {
  it("idle → open → submitting → accepted → done", async () => {
    const { c, calls, seen } = make();
    expect(c.getState().status).toBe("idle");
    c.open();
    c.setField("text", "The export button does nothing.");
    await c.submit();
    expect(seen).toEqual(["open", "open", "submitting", "accepted", "done"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://in.test/api/v1/user-feedback");
    expect(calls[0]!.body.options).toEqual({ follow_ups: { count: 1, dynamic: true } });
    const r = calls[0]!.body.report;
    expect(r.summary).toBe("The export button does nothing.");
    expect(r.details).toBeUndefined();
    expect(r.source).toMatchObject({ kind: "human", surface: "web" });
    expect(calls[0]!.body.sdk.name).toBe("@mostlovedproduct/web");
    expect(c.getState().reportId).toBe(calls[0]!.body.id);
    expect(c.getState().draft.text).toBe("");
  });

  it("makes no network request before submit", () => {
    const { c, calls } = make();
    c.open({ kind: "idea", prefill: "x" });
    c.setContext({ a: 1 });
    c.close();
    expect(calls).toHaveLength(0);
  });

  it("rejects empty text without sending", async () => {
    const { c, calls } = make();
    c.open();
    c.setField("text", "   ");
    await c.submit();
    expect(calls).toHaveLength(0);
    expect(c.getState()).toMatchObject({ status: "error", error: { field: "text", phase: "submit" } });
    c.setField("text", "ok");
    expect(c.getState().status).toBe("open");
    expect(c.getState().error).toBeUndefined();
  });

  it("an error keeps the draft and allows a retry", async () => {
    const onError = vi.fn();
    const { c, calls } = make({ onError }, { status: 503 }, {});
    c.open({ kind: "broken" });
    c.setField("text", "Checkout fails on step 2");
    await c.submit();
    const s = c.getState();
    expect(s.status).toBe("error");
    expect(s.error).toMatchObject({ code: "unavailable", retryable: true, phase: "submit" });
    expect(s.draft).toMatchObject({ text: "Checkout fails on step 2", kind: "broken" });
    expect(onError).toHaveBeenCalledTimes(1);
    await c.submit();
    expect(c.getState().status).toBe("done");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.report.summary).toBe("Checkout fails on step 2");
  });

  it("retry after a timeout resends the identical envelope; a duplicate receipt is success", async () => {
    const onSubmit = vi.fn();
    const { c, calls } = make(
      { timeoutMs: 100, onSubmit },
      { delay: 300 },
      (call) => ({ body: { report_id: call.body.id, status: "captured", duplicate: true, message: "ok" } }),
    );
    c.open({ kind: "broken" });
    c.setField("text", "Checkout fails on step 2");
    await c.submit();
    expect(c.getState()).toMatchObject({ status: "error", error: { code: "timeout", retryable: true } });
    c.setField("text", "Checkout fails on step 2"); // touched, but unchanged
    await tick(20);
    await c.submit();
    expect(c.getState()).toMatchObject({ status: "done", reportId: calls[0]!.body.id });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.body)).toBe(JSON.stringify(calls[0]!.body));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true, reportId: calls[0]!.body.id }));
  });

  it("an edited draft after a failure is a new report", async () => {
    const { c, calls } = make({}, { status: 0 }, { status: 0 }, {});
    c.open();
    c.setField("text", "first try");
    await c.submit();
    await c.submit(); // unchanged: same id
    c.setField("text", "first try, more detail");
    await c.submit(); // edited: new id
    expect(calls).toHaveLength(3);
    expect(calls[1]!.body.id).toBe(calls[0]!.body.id);
    expect(calls[1]!.body.sent_at).toBe(calls[0]!.body.sent_at);
    expect(calls[2]!.body.id).not.toBe(calls[0]!.body.id);
    expect(calls[2]!.body.report.summary).toBe("first try, more detail");
  });

  it("a failed send retains the original context when the widget reopens during the request", async () => {
    const { c, calls } = make({}, { status: 0, delay: 20 }, {});
    c.open({ context: { step: "billing" } });
    c.setField("text", "Save failed");
    const send = c.submit();
    c.close();
    c.open({ context: { step: "profile" } });
    await send;
    await c.submit();

    expect(calls.map(({ body }) => body.report.context.step)).toEqual(["billing", "profile"]);
    expect(calls[1]!.body.id).not.toBe(calls[0]!.body.id);
  });

  it("a non-transient failure is re-submitted as a new envelope", async () => {
    const { c, calls } = make({}, { status: 400, body: { error: { code: "invalid_payload", message: "bad", retryable: false, field: "report.kind" } } }, {});
    c.open();
    c.setField("text", "x");
    await c.submit();
    expect(c.getState().error).toMatchObject({ code: "invalid_payload", field: "report.kind" });
    await c.submit();
    expect(calls[1]!.body.id).not.toBe(calls[0]!.body.id);
  });

  it("network failure keeps the draft", async () => {
    const { c } = make({}, { status: 0 });
    c.open();
    c.setField("text", "hello");
    await c.submit();
    expect(c.getState()).toMatchObject({ status: "error", draft: { text: "hello" }, error: { code: "network" } });
  });

  it("closing keeps an unsent draft; reopening restores it", () => {
    const { c } = make();
    c.open();
    c.setField("text", "half written");
    c.close();
    expect(c.getState().status).toBe("idle");
    c.open({ prefill: "should not replace" });
    expect(c.getState().draft.text).toBe("half written");
  });

  it("closing while submitting still finishes; reopen starts fresh", async () => {
    const onSubmit = vi.fn();
    const { c } = make({ onSubmit }, { delay: 20 });
    c.open();
    c.setField("text", "x");
    const p = c.submit();
    c.close();
    await p;
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(c.getState().status).toBe("idle");
    c.open();
    expect(c.getState()).toMatchObject({ status: "open", draft: { text: "" } });
  });

  it("ignores double submit while in flight", async () => {
    const { c, calls } = make({}, { delay: 10 });
    c.open();
    c.setField("text", "x");
    await Promise.all([c.submit(), c.submit()]);
    expect(calls).toHaveLength(1);
  });

  it("reset clears the draft and stays open", () => {
    const { c } = make();
    c.open();
    c.setField("text", "abc");
    c.reset();
    expect(c.getState()).toMatchObject({ status: "open", draft: { text: "" } });
  });

  it("destroy stops everything", async () => {
    const l = vi.fn();
    const { c } = make();
    c.subscribe(l);
    c.destroy();
    c.open();
    await c.submit();
    expect(l).not.toHaveBeenCalled();
  });
});

describe("summary / details", () => {
  it("uses the first sentence as summary and keeps the full text in details", () => {
    expect(splitText("Export is broken. It spins forever and then nothing.")).toEqual({
      summary: "Export is broken.",
      details: "Export is broken. It spins forever and then nothing.",
    });
  });
  it("single sentence: summary only", () => {
    expect(splitText("  Love the new dashboard  ")).toEqual({ summary: "Love the new dashboard" });
  });
  it("first line wins when there is no sentence end", () => {
    expect(splitText("Search is slow\nespecially with filters")).toEqual({
      summary: "Search is slow",
      details: "Search is slow\nespecially with filters",
    });
  });
  it("does not split on decimals or URLs", () => {
    expect(splitText("Version 2.5 broke login").summary).toBe("Version 2.5 broke login");
  });
  it("caps the summary at 300 chars on a word boundary", () => {
    const long = ("word ".repeat(100) + "end").trim();
    const r = splitText(long);
    expect(Array.from(r.summary).length).toBeLessThanOrEqual(300);
    expect(r.summary.endsWith("…")).toBe(true);
    expect(r.details).toBe(long);
  });
  it("caps details at 4000 code points", () => {
    const r = splitText("a. " + "b".repeat(5000));
    expect(Array.from(r.details!).length).toBe(4000);
  });
});

describe("follow-ups", () => {
  it("shows and answers the exact generated question", async () => {
    const question = "Which format did you choose for the export?";
    const { c, calls } = make(
      { strings: { followUps: { open: { question: "Local override" } } } },
      withFollowUp({ ...followUp("open", "text"), question }),
      {},
    );
    c.open();
    c.setField("text", "Export fails.");
    await c.submit();
    expect(c.getState().followUp).toMatchObject({ id: "open", input: "text", question });
    await c.answerFollowUp({ text: "CSV" });
    expect(calls[1]!.body.answer).toMatchObject({ follow_up_id: "open", reply_token: "tok_open", text: "CSV" });
    expect(c.getState().status).toBe("done");
  });

  it("choice answer, then done", async () => {
    const onFollowUp = vi.fn();
    const { c, calls } = make({ onFollowUp }, withFollowUp(followUp("impact")), {});
    c.open();
    c.setField("text", "It crashes");
    await c.submit();
    const s = c.getState();
    expect(s.status).toBe("follow_up");
    expect(s.followUp).toMatchObject({ id: "impact", input: "choice", index: 1 });
    expect(s.followUp!.options!.map((o) => o.id)).toEqual(["blocked", "friction"]);
    await c.answerFollowUp({ optionId: "blocked" });
    expect(c.getState().status).toBe("done");
    expect(calls[1]!.url).toBe("https://in.test/api/v1/user-feedback/answers");
    expect(calls[1]!.body.answer).toMatchObject({
      report_id: s.reportId, follow_up_id: "impact", option_id: "blocked", reply_token: "tok_impact",
    });
    expect(onFollowUp.mock.calls.map((a) => a[0].action)).toEqual(["shown", "answered"]);
  });

  it("text answer and a second question when allowed", async () => {
    const { c, calls } = make({ followUps: 2 }, withFollowUp(followUp("impact")), withFollowUp(followUp("expected", "text")), {});
    c.open();
    c.setField("text", "Hmm");
    await c.submit();
    expect(calls[0]!.body.options).toEqual({ follow_ups: { count: 2, dynamic: true } });
    await c.answerFollowUp({ optionId: "blocked" });
    expect(c.getState().followUp).toMatchObject({ id: "expected", input: "text", index: 2 });
    await c.answerFollowUp({ text: "  It should save  " });
    expect(calls[2]!.body.answer).toMatchObject({ follow_up_id: "expected", text: "It should save" });
    expect(c.getState().status).toBe("done");
  });

  it("never shows more than the configured number", async () => {
    const { c } = make({ followUps: 1 }, withFollowUp(followUp("impact")), withFollowUp(followUp("task", "text")));
    c.open();
    c.setField("text", "x");
    await c.submit();
    await c.answerFollowUp({ optionId: "blocked" });
    expect(c.getState().status).toBe("done");
  });

  it("skip sends skipped: true", async () => {
    const { c, calls } = make({}, withFollowUp(followUp("use_case", "text")), {});
    c.open();
    c.setField("text", "Add CSV export");
    await c.submit();
    await c.skipFollowUp();
    expect(calls[1]!.body.answer).toMatchObject({ follow_up_id: "use_case", skipped: true });
    expect(c.getState().status).toBe("done");
  });

  it("empty text answer is ignored", async () => {
    const { c, calls } = make({}, withFollowUp(followUp("task", "text")));
    c.open();
    c.setField("text", "x");
    await c.submit();
    await c.answerFollowUp({ text: "  " });
    expect(calls).toHaveLength(1);
    expect(c.getState().status).toBe("follow_up");
  });

  it("a failed answer still ends in done (the report is saved)", async () => {
    const onError = vi.fn();
    const { c } = make({ onError }, withFollowUp(followUp("impact")), { status: 410 });
    c.open();
    c.setField("text", "x");
    await c.submit();
    await c.answerFollowUp({ optionId: "friction" });
    expect(c.getState().status).toBe("done");
    expect(onError.mock.calls[0]![0]).toMatchObject({ code: "follow_up_expired", phase: "answer" });
  });

  it("localizes questions and options by stable id", async () => {
    const { c } = make(
      { strings: { followUps: { impact: { question: "¿Te bloqueó?", options: { blocked: "Sí, me bloqueó" } } } } },
      withFollowUp(followUp("impact")),
    );
    c.open();
    c.setField("text", "x");
    await c.submit();
    const f = c.getState().followUp!;
    expect(f.question).toBe("¿Te bloqueó?");
    expect(f.options).toEqual([
      { id: "blocked", label: "Sí, me bloqueó" },
      { id: "friction", label: "Minor annoyance" },
    ]);
  });

  it("closing during a follow-up resets for next time", async () => {
    const { c } = make({}, withFollowUp(followUp("impact")));
    c.open();
    c.setField("text", "x");
    await c.submit();
    c.close();
    c.open();
    expect(c.getState()).toMatchObject({ status: "open", draft: { text: "" } });
    expect(c.getState().followUp).toBeUndefined();
  });
});

describe("context", () => {
  it("merge order: init < setters < getContext < open overrides", async () => {
    const { c, calls } = make({
      user: { id: "u_init", tier: "free", traits: { a: "init", b: "init" } },
      flags: { f1: "init", f2: "init" },
      app: { version: "1.0.0", env: "prod" },
      context: { c1: "init", c2: "init", c3: "init", c4: "init" },
      getContext: () => ({ context: { c3: "get", c4: "get" }, flags: { f2: "get" }, page: { title: "From getContext" } }),
    });
    c.setContext({ c2: "set", c3: "set", c4: "set" });
    c.setUser({ tier: "pro", traits: { b: "set" } });
    c.setFlags({ f1: "set" });
    c.setApp({ version: "1.1.0" });
    c.open({ context: { c4: "open" }, subject: "Checkout" });
    c.setField("text", "x");
    await c.submit();
    const r = calls[0]!.body.report;
    expect(r.context).toEqual({ c1: "init", c2: "set", c3: "get", c4: "open" });
    expect(r.user).toEqual({ id: "u_init", tier: "pro", traits: { a: "init", b: "set" } });
    expect(r.flags).toEqual({ f1: "set", f2: "get" });
    expect(r.app).toEqual({ version: "1.1.0", env: "prod" });
    expect(r.subject).toEqual({ type: "feature", name: "Checkout" });
    expect(r.page.title).toBe("From getContext");
    expect(r.page.path).toBe(location.pathname);
  });

  it("open overrides apply to one report only", async () => {
    const { c, calls } = make({}, {});
    c.open({ context: { step: "pay" } });
    c.setField("text", "x");
    await c.submit();
    c.close();
    c.open();
    c.setField("text", "y");
    await c.submit();
    expect(calls[0]!.body.report.context).toEqual({ step: "pay" });
    expect(calls[1]!.body.report.context).toBeUndefined();
  });

  it("identify(null) clears the user", async () => {
    const { c, calls } = make({ user: { id: "u1" } });
    c.setUser(null);
    c.open();
    c.setField("text", "x");
    await c.submit();
    expect(calls[0]!.body.report.user).toBeUndefined();
  });

  it("a throwing or slow getContext is ignored, page context still sent", async () => {
    const { c, calls } = make({ getContext: () => { throw new Error("boom"); } });
    c.open();
    c.setField("text", "x");
    await c.submit();
    expect(calls[0]!.body.report.page.path).toBe(location.pathname);

    const slow = make({ getContext: () => new Promise((r) => setTimeout(() => r({ context: { late: true } }), 2000)) });
    slow.c.open();
    slow.c.setField("text", "x");
    const t = Date.now();
    await slow.c.submit();
    expect(Date.now() - t).toBeLessThan(1000);
    expect(slow.calls[0]!.body.report.context).toBeUndefined();
    expect(slow.calls[0]!.body.report.page).toBeDefined();
  });

  it("sloppy customer values are coerced instead of failing the report", async () => {
    const { c, calls } = make({
      context: { nested: { a: 1 }, fn: () => 1, n: NaN, long: "x".repeat(900), list: [1, "two", { three: 3 }], ok: true } as never,
      flags: { variant: 3 as never },
      user: { id: 42 as never },
    });
    c.open();
    c.setField("text", "x");
    await c.submit();
    expect(c.getState().status).toBe("done");
    const r = calls[0]!.body.report;
    expect(r.context).toEqual({ nested: '{"a":1}', n: "NaN", long: "x".repeat(500), list: ["1", "two", '{"three":3}'], ok: true });
    expect(r.flags).toEqual({ variant: "3" });
    expect(r.user).toEqual({ id: "42" });
  });

  it("cleanProps caps keys at 32", () => {
    const big = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanProps(big)!)).toHaveLength(32);
  });

  it("beforeSend can edit or drop; redaction runs", async () => {
    const { c, calls } = make({
      beforeSend: (r) => (r.summary.includes("drop") ? null : { ...r, context: { ...r.context, edited: true } }),
    });
    c.open();
    c.setField("text", "please drop this");
    await c.submit();
    expect(calls).toHaveLength(0);
    expect(c.getState()).toMatchObject({ status: "error", error: { code: "dropped" }, draft: { text: "please drop this" } });
    c.setField("text", "my token=abc123secret is visible");
    await c.submit();
    expect(calls[0]!.body.report.context).toEqual({ edited: true });
    expect(calls[0]!.body.report.summary).toContain("[redacted:secret]");
  });
});

describe("page context", () => {
  const sent = async (extra: Partial<ControllerConfig> = {}) => {
    const { c, calls } = make(extra);
    c.open();
    c.setField("text", "x");
    await c.submit();
    return calls[0]!.body.report.page;
  };

  it("strips query and fragment by default (in core)", async () => {
    history.replaceState(null, "", "/orders/42?token=abc#frag");
    document.title = "Order 42";
    const p = await sent();
    expect(p.url).toBe(`${location.origin}/orders/42`);
    expect(p.path).toBe("/orders/42");
    expect(p.title).toBe("Order 42");
    expect(p.viewport).toMatch(/^\d+x\d+$/);
    expect(p.locale).toBeTruthy();
    // collectPage hands core the raw URL; core does the stripping.
    expect(collectPage(undefined)!.url).toBe(`${location.origin}/orders/42?token=abc#frag`);
  });

  it("opts in to query and hash", async () => {
    history.replaceState(null, "", "/a?x=1#/route");
    expect((await sent({ page: { includeQuery: true } })).url).toBe(`${location.origin}/a?x=1`);
    expect((await sent({ page: { includeQuery: true, includeHash: true } })).url).toBe(`${location.origin}/a?x=1#/route`);
    const hashOnly = await sent({ page: { includeHash: true } });
    expect(hashOnly.url).toBe(`${location.origin}/a#/route`);
    expect(hashOnly.path).toBe("/a#/route");
  });

  it("also strips a page.url supplied by getContext", async () => {
    const p = await sent({ getContext: () => ({ page: { url: "https://x.test/p?secret=1#h", referrer: "https://r.test/?q=1" } }) });
    expect(p.url).toBe("https://x.test/p");
    expect(p.referrer).toBe("https://r.test/");
  });

  it("page: false disables it", async () => {
    expect(collectPage(false)).toBeUndefined();
    expect(await sent({ page: false })).toBeUndefined();
  });
});

describe("hooks", () => {
  it("shows acceptance while the question is pending and lets the user leave", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let reportId!: string;
    const onSubmit = vi.fn();
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      reportId = JSON.parse(String(init?.body)).id;
      return new Response(new ReadableStream<Uint8Array>({ start: (controller) => { stream = controller; } }), {
        status: 202, headers: { "Content-Type": CAPTURE_STREAM_TYPE },
      });
    };
    const c = createFeedback({ key: KEY, fetch, onSubmit });
    c.open();
    c.setField("text", "Export fails.");
    const pending = c.submit();
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream.enqueue(captureFrame("captured", { report_id: reportId, status: "captured", duplicate: false, message: "Saved." }));
    await vi.waitFor(() => expect(c.getState()).toMatchObject({ status: "accepted", reportId }));
    c.close();
    await pending;
    expect(c.getState().status).toBe("idle");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("an onSubmit hook can close the widget without the receipt reopening it", async () => {
    const onFollowUp = vi.fn();
    const { c } = make({ onSubmit: () => c.close(), onFollowUp }, withFollowUp(followUp("impact")));
    c.open({ prefill: "Something broke" });
    await c.submit();

    expect(c.getState()).toMatchObject({ status: "idle", draft: { text: "" } });
    expect(c.getState().reportId).toBeUndefined();
    expect(onFollowUp).not.toHaveBeenCalled();
  });

  it("a subscriber can reset during the busy notification without sending an abandoned answer", async () => {
    const { c, calls } = make({}, withFollowUp(followUp("impact")));
    c.open({ prefill: "Something broke" });
    await c.submit();
    c.subscribe((state) => {
      if (state.busy) c.reset();
    });
    await c.answerFollowUp({ optionId: "blocked" });

    expect(c.getState()).toMatchObject({ status: "open", busy: false });
    expect(calls).toHaveLength(1);
  });

  it("throwing or rejecting hooks never break the flow", async () => {
    const boom = () => {
      throw new Error("hook");
    };
    const { c } = make(
      {
        onOpen: boom,
        onClose: boom,
        onSubmit: () => Promise.reject(new Error("async hook")),
        onFollowUp: boom,
        onError: boom,
      },
      withFollowUp(followUp("impact")),
      {},
    );
    c.subscribe(boom);
    c.open();
    c.setField("text", "x");
    await c.submit();
    expect(c.getState().status).toBe("follow_up");
    await c.answerFollowUp({ optionId: "blocked" });
    expect(c.getState().status).toBe("done");
    c.close();
    expect(c.getState().status).toBe("idle");
    await tick();
  });

  it("onOpen/onClose fire once per transition", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { c } = make({ onOpen, onClose });
    c.open();
    c.open();
    c.close();
    c.close();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("onSubmit receives the receipt", async () => {
    const onSubmit = vi.fn();
    const { c, calls } = make({ onSubmit });
    c.open();
    c.setField("text", "x");
    await c.submit();
    expect(onSubmit).toHaveBeenCalledWith({ ok: true, reportId: calls[0]!.body.id, duplicate: false, message: "ok" });
  });
});

describe("misconfiguration", () => {
  it("a missing key surfaces as an error, never a throw", async () => {
    const c = createFeedback({ key: "" });
    c.open();
    c.setField("text", "x");
    await c.submit();
    expect(c.getState()).toMatchObject({ status: "error", error: { code: "invalid_input", field: "key" }, draft: { text: "x" } });
    // @ts-expect-error deliberately wrong
    expect(() => createFeedback(undefined)).not.toThrow();
  });
});
