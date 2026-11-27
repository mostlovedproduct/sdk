import { uuidv7 } from "./protocol/ids.js";
import { redactReport, redactText, stripUrl } from "./protocol/redact.js";
import {
  CAPTURE_PATHS,
  FOLLOW_UP_IDS,
  LIMITS,
  PROTOCOL_VERSION,
  type Answer,
  type Envelope,
  type FollowUp,
  type Receipt,
  type Report,
  type SdkInfo,
  type UserContext,
} from "./protocol/types.js";
import { post, type TransportConfig } from "./transport.js";
import type {
  AnswerValue,
  Client,
  ClientConfig,
  ClientError,
  ClientErrorCode,
  ContextFields,
  FollowUpHandle,
  ReportInput,
  RetryOptions,
  SubmitFailure,
  SubmitOptions,
  SubmitResult,
} from "./types.js";
import { CORE_VERSION } from "./version.js";

export const DEFAULT_ENDPOINT = "https://in.mostlovedproduct.com";
/** Cap on the time `getContext()` may take. */
export const GET_CONTEXT_TIMEOUT_MS = 500;

/** Failures worth resending unchanged. */
const RESENDABLE: readonly ClientErrorCode[] = ["network", "timeout", "unavailable", "rate_limited"];

function fail(code: ClientError["code"], message: string, extra: Partial<ClientError> = {}): SubmitResult {
  const retryable = code === "network" || code === "timeout";
  return { ok: false, error: { code, message, retryable, ...extra } };
}

/** A bug or hostile input reached a catch-all: still a result, never a rejection. */
function unexpected(err: unknown): SubmitResult {
  return fail("invalid_input", `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Shallow merge that ignores undefined values from `b`. */
function assign<T extends object>(a: T | undefined, b: T | undefined): T | undefined {
  if (!isObject(b)) return a;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown> | undefined) };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) out[k] = v;
  return out as T;
}

function mergeUser(a: UserContext | undefined, b: UserContext | undefined): UserContext | undefined {
  if (!isObject(b)) return a;
  const out = assign<UserContext>(a, b)!;
  const traits = assign<Record<string, unknown>>(a?.traits, (b as UserContext).traits) as UserContext["traits"];
  if (traits) out.traits = traits;
  return out;
}

/** Later layers win; objects merge one level deep (user.traits two). */
function mergeContext(a: ContextFields, b: Partial<ContextFields> | null | undefined): ContextFields {
  if (!isObject(b)) return a;
  const out: ContextFields = { ...a };
  const user = mergeUser(a.user, b.user);
  if (user) out.user = user;
  for (const k of ["flags", "app", "page", "context"] as const) {
    const v = assign<object>(a[k], b[k]);
    if (v) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Run `fn` with a time cap. Resolves `undefined` on throw, reject or timeout. Clears its timer. */
async function capped<T>(fn: () => T | Promise<T>, ms: number): Promise<{ value?: T; timedOut: boolean; threw: boolean }> {
  if (ms <= 0) return { timedOut: true, threw: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true; threw: false }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, threw: false }), ms);
  });
  const work = (async () => ({ value: await fn(), timedOut: false, threw: false }))().catch(() => ({
    timedOut: false,
    threw: true,
  }));
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEndpoint(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Creates a capture client. Never throws; configuration
 * problems surface as `{ ok: false, error: { code: "invalid_input" } }` from `submit()`.
 */
export function createClient(config: ClientConfig): Client {
  const cfg: Partial<ClientConfig> = isObject(config) ? config : {};
  const timeoutMs = typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0 ? cfg.timeoutMs : LIMITS.sdkTimeoutMs;
  const endpoints = [normalizeEndpoint(cfg.endpoint ?? DEFAULT_ENDPOINT)];
  if (cfg.fallbackEndpoint) endpoints.push(normalizeEndpoint(cfg.fallbackEndpoint));
  const mcpCapture = cfg.capture === "mcp-feedback";
  const reportPath = mcpCapture ? CAPTURE_PATHS.mcpFeedback : CAPTURE_PATHS.userFeedback;
  const fetchImpl: typeof fetch =
    cfg.fetch ?? ((input, init) => (globalThis.fetch ? globalThis.fetch(input, init) : Promise.reject(new Error("fetch is not available"))));
  const sdk: SdkInfo = cfg.sdk ?? { name: "@mostlovedproduct/core", version: CORE_VERSION };
  const redactOpts = cfg.redact === false ? null : (cfg.redact ?? {});
  const key = typeof cfg.key === "string" ? cfg.key : "";
  const providers = cfg.getContext ? (Array.isArray(cfg.getContext) ? cfg.getContext : [cfg.getContext]) : [];
  const keepUrl = cfg.keepUrl ?? false;

  let state: ContextFields = mergeContext({}, { user: cfg.user, flags: cfg.flags, app: cfg.app, page: cfg.page, context: cfg.context });

  const transportFor = (order: string[]): TransportConfig => ({ key, endpoints: order, fetch: fetchImpl });

  function checkBodySize(body: string): SubmitResult | null {
    const size = new TextEncoder().encode(body).length;
    if (size > LIMITS.bodyBytes) {
      return fail("invalid_input", `Body is ${size} bytes; the limit is ${LIMITS.bodyBytes}`);
    }
    return null;
  }

  /**
   * POST an already-serialized body with a fresh deadline. Transient failures carry `retry()`,
   * which sends the very same string again (same id), so a lost receipt never doubles a report.
   */
  async function deliver(
    order: string[],
    path: string,
    body: string,
    deadline: number,
    signal: AbortSignal | undefined,
    onOk: (responseBody: unknown, endpointIndex: number) => SubmitResult,
  ): Promise<SubmitResult> {
    try {
      const res = await post(transportFor(order), path, body, deadline, signal, {
        onCaptured: (receipt) => notify(() => cfg.onCaptured?.({
          ok: true, reportId: receipt.report_id, duplicate: receipt.duplicate, message: receipt.message,
        })),
        onFollowUpPending: () => notify(() => cfg.onFollowUpPending?.()),
      });
      if (res.ok) return onOk(res.body, res.endpointIndex);
      const out: SubmitFailure = { ok: false, error: res.error };
      if (RESENDABLE.includes(res.error.code)) {
        out.retry = (o) => deliver(order, path, body, Date.now() + timeoutMs, isObject(o) ? (o as RetryOptions).signal : undefined, onOk);
      }
      return out;
    } catch (err) {
      return unexpected(err);
    }
  }

  function notify(hook: () => void) {
    try {
      void Promise.resolve(hook()).catch(() => {});
    } catch {
      // An integrator callback does not interrupt capture or the question.
    }
  }

  function toResult(
    body: unknown,
    fallbackId: string,
    endpointIndex: number,
  ): SubmitResult {
    const r = (isObject(body) ? body : {}) as Partial<Receipt>;
    const reportId = typeof r.report_id === "string" ? r.report_id : fallbackId;
    const out: SubmitResult = {
      ok: true,
      reportId,
      duplicate: r.duplicate === true,
      message: typeof r.message === "string" ? r.message : "Captured",
    };
    const handle = r.follow_up && !mcpCapture ? followUpHandle(reportId, r.follow_up, endpointIndex) : undefined;
    if (handle) out.followUp = handle;
    return out;
  }

  function followUpHandle(reportId: string, f: FollowUp, endpointIndex: number): FollowUpHandle | undefined {
    if (!isObject(f) || !FOLLOW_UP_IDS.includes(f.id) || typeof f.reply_token !== "string") return undefined;
    if (f.input !== "choice" && f.input !== "text") return undefined;
    // Answers go first to the endpoint that accepted the report, then to the other one.
    const order = endpoints.slice(endpointIndex).concat(endpoints.slice(0, endpointIndex));
    let inflight: Promise<SubmitResult> | undefined;
    let done: SubmitResult | undefined;

    const send = (partial: Pick<Answer, "option_id" | "text" | "skipped">): Promise<SubmitResult> => {
      if (done) return Promise.resolve(done);
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const answer: Answer = { report_id: reportId, follow_up_id: f.id, reply_token: f.reply_token, ...partial };
          const envelope: Envelope = {
            v: PROTOCOL_VERSION,
            id: uuidv7(),
            type: "answer",
            sent_at: new Date().toISOString(),
            sdk,
            answer,
          };
          const body = JSON.stringify(envelope);
          const invalid = checkBodySize(body);
          if (invalid) return invalid;
          return await deliver(order, CAPTURE_PATHS.userFeedbackAnswers, body, Date.now() + timeoutMs, undefined, (resBody, i) => {
            done = toResult(resBody, reportId, (endpointIndex + i) % endpoints.length);
            return done;
          });
        } catch (err) {
          return unexpected(err);
        } finally {
          inflight = undefined;
        }
      })();
      return inflight;
    };

    const handle: FollowUpHandle = {
      id: f.id,
      question: typeof f.question === "string" ? f.question : "",
      input: f.input,
      expiresAt: typeof f.expires_at === "string" ? f.expires_at : "",
      answer(value: AnswerValue) {
        try {
          if (f.input === "choice") {
            const optionId = isObject(value) ? (value as { optionId?: unknown }).optionId : undefined;
            if (typeof optionId !== "string" || (handle.options && !handle.options.some((o) => o.id === optionId))) {
              return Promise.resolve(fail("invalid_input", "Pick one of the offered options", { field: "optionId" }));
            }
            return send({ option_id: optionId });
          }
          const text = isObject(value) ? (value as { text?: unknown }).text : undefined;
          if (typeof text !== "string" || text.trim() === "") {
            return Promise.resolve(fail("invalid_input", "Answer text is required", { field: "text" }));
          }
          const clean = redactOpts ? redactText(text, redactOpts).value : text;
          return send({ text: clean });
        } catch (err) {
          return Promise.resolve(fail("invalid_input", err instanceof Error ? err.message : String(err)));
        }
      },
      skip() {
        return send({ skipped: true });
      },
    };
    if (Array.isArray(f.options)) handle.options = f.options.map((o) => ({ id: String(o.id), label: String(o.label) }));
    return handle;
  }

  async function submit(input: ReportInput, options: SubmitOptions = {}): Promise<SubmitResult> {
    try {
      const deadline = Date.now() + timeoutMs;
      if (key.trim() === "") return fail("invalid_input", "The capture key is required", { field: "key" });
      if (!isObject(input)) return fail("invalid_input", "Report must be an object");
      const opts: SubmitOptions = isObject(options) ? (options as SubmitOptions) : {};

      // Context: static < setX < getContext() providers < report input. Each provider is capped on its
      // own; one that throws or is too slow drops only its own contribution.
      let ctx = state;
      if (providers.length) {
        const cap = Math.min(GET_CONTEXT_TIMEOUT_MS, deadline - Date.now());
        const results = await Promise.all(providers.map((p) => capped(() => (typeof p === "function" ? p() : undefined), cap)));
        for (const r of results) ctx = mergeContext(ctx, r.value);
      }
      const { source: inputSource, ...rest } = input;
      ctx = mergeContext(ctx, rest as Partial<ContextFields>);
      let report = {
        ...rest,
        ...ctx,
        source: { kind: "human", surface: "api", ...cfg.source, ...inputSource },
      } as Report;
      for (const k of Object.keys(report) as (keyof Report)[]) if (report[k] === undefined) delete report[k];
      report = stripPage(report, keepUrl);

      if (cfg.beforeSend) {
        const beforeSend = cfg.beforeSend;
        const snapshot = report;
        const r = await capped(() => beforeSend(snapshot), deadline - Date.now());
        if (r.timedOut) return fail("timeout", "beforeSend did not finish before the deadline");
        if (r.threw) return fail("dropped", "beforeSend threw; the report was not sent");
        if (r.value === null) return fail("dropped", "beforeSend dropped the report");
        if (!isObject(r.value)) return fail("dropped", "beforeSend did not return a report; the report was not sent");
        report = r.value;
      }

      if (redactOpts) report = redactReport(report, redactOpts).value;
      if (typeof report.summary !== "string" || report.summary.trim() === "") {
        return fail("invalid_input", "Summary is required", { field: "summary" });
      }
      if ([...report.summary].length > LIMITS.summaryMax) {
        return fail("invalid_input", `Summary must be at most ${LIMITS.summaryMax} characters`, { field: "summary" });
      }

      const followUps = opts.followUps ?? cfg.followUps;
      const dynamic = !mcpCapture && cfg.dynamicFollowUps === true && followUps !== 0;
      const envelope: Envelope = {
        v: PROTOCOL_VERSION,
        id: uuidv7(),
        type: "report",
        sent_at: new Date().toISOString(),
        sdk,
        report,
      };
      if (followUps !== undefined || dynamic) {
        envelope.options = { follow_ups: { count: followUps ?? LIMITS.defaultFollowUps, dynamic } };
      }

      const body = JSON.stringify(envelope);
      const invalid = checkBodySize(body);
      if (invalid) return invalid;
      return await deliver(endpoints, reportPath, body, deadline, opts.signal, (resBody, i) => toResult(resBody, envelope.id, i));
    } catch (err) {
      return unexpected(err);
    }
  }

  return {
    submit,
    setContext(props) {
      state = mergeContext(state, { context: props });
    },
    setUser(user) {
      if (user === null) {
        const { user: _drop, ...restState } = state;
        void _drop;
        state = restState;
      } else state = mergeContext(state, { user });
    },
    setFlags(flags) {
      state = mergeContext(state, { flags });
    },
    setApp(app) {
      state = mergeContext(state, { app });
    },
  };
}

/** Contract section 5: no query string or fragment on page URLs unless the customer opts in. */
function stripPage(report: Report, keep: NonNullable<ClientConfig["keepUrl"]>): Report {
  const page = report.page;
  if (keep === true || !isObject(page)) return report;
  const out = { ...page };
  if (typeof out.url === "string") out.url = stripUrl(out.url, keep);
  if (typeof out.referrer === "string") out.referrer = stripUrl(out.referrer, keep);
  return { ...report, page: out };
}
