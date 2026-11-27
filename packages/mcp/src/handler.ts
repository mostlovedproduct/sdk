import {
  createClient,
  DEFAULT_ENDPOINT,
  type AppContext,
  type ClientError,
  type Flags,
  type Props,
  type Report,
  type Source,
  type UserContext,
} from "@mostlovedproduct/core";
import { MCP_VERSION } from "./version.js";
import {
  feedbackInstructions,
  feedbackTool,
  resolveToolOptions,
  type FeedbackToolDefinition,
  type FeedbackToolOptions,
} from "./tool.js";
import { validateArgs, type FeedbackArgs } from "./validate.js";
import { RESULT_TEXTS, WORDING_VERSION, fill, type Profile } from "./wording.js";

/** Trusted context the server attaches. Never comes from the model. */
export interface FeedbackContext {
  trust?: NonNullable<Source["trust"]>;
  client?: NonNullable<Source["client"]>;
  user?: UserContext;
  app?: AppContext;
  flags?: Flags;
  context?: Props;
}

export type FeedbackFailureReason =
  | "disabled"
  | "timeout"
  | "network"
  | "rate_limited"
  | "unauthorized"
  | "unavailable"
  | "rejected"
  | "internal";

export type FeedbackOutcome =
  | { status: "recorded"; reportId: string; duplicate: boolean; kind: FeedbackArgs["kind"]; tool?: string; durationMs: number }
  | { status: "failed"; reason: FeedbackFailureReason; error?: ClientError; kind?: FeedbackArgs["kind"]; tool?: string; durationMs: number }
  | { status: "invalid"; field: string; message: string; durationMs: number };

export interface FeedbackHandlerOptions<T = unknown> extends FeedbackToolOptions {
  /** Server capture key (`mlp_sk_...`). Keep it a secret. */
  key: string;
  endpoint?: string;
  fallbackEndpoint?: string;
  /** Total time budget for one call, ms. Default 3000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Kill switch, checked on every call. `false` (or a throw) makes the tool report a harmless failure. */
  enabled?: () => boolean | Promise<boolean>;
  /** Trusted per-call context. A throw is swallowed and the report goes out without it. */
  context?: (callInfo: T) => FeedbackContext | null | undefined | Promise<FeedbackContext | null | undefined>;
  /** For the server's own logging and metrics. Wrapped: it can neither throw nor delay the result. */
  onResult?: (outcome: FeedbackOutcome, callInfo: T | undefined) => void | Promise<void>;
}

export interface FeedbackCallResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { recorded: true; report_id: string } | { recorded: false };
  isError?: boolean;
  [key: string]: unknown;
}

export interface FeedbackHandler<T = unknown> {
  tool: FeedbackToolDefinition;
  /** Never throws or rejects; resolves within `timeoutMs` plus a small margin. */
  call(args: unknown, callInfo?: T): Promise<FeedbackCallResult>;
  /** One line for the MCP server `instructions` (empty for the conservative profile). */
  instructions: string;
}

export const DEFAULT_TIMEOUT_MS = 3000;
/** Margin past `timeoutMs` after which the call resolves regardless of what is still running. */
export const CALL_MARGIN_MS = 150;
const CONTEXT_TIMEOUT_MS = 500;
const PROPS_MAX_KEYS = 32;

const text = (t: string) => [{ type: "text" as const, text: t }];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Run `fn` capped at `ms`; resolves `undefined` value + flags instead of throwing or hanging. */
async function capped<R>(fn: () => R | Promise<R>, ms: number): Promise<{ value?: R; ok: boolean }> {
  if (ms <= 0) return { ok: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), ms);
  });
  const work = (async () => ({ ok: true as const, value: await fn() }))().catch(() => ({ ok: false as const }));
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function failureReason(e: ClientError): FeedbackFailureReason {
  switch (e.code) {
    case "timeout":
      return "timeout";
    case "network":
      return "network";
    case "rate_limited":
      return "rate_limited";
    case "unauthorized":
      return "unauthorized";
    case "unavailable":
      return "unavailable";
    default:
      return "rejected";
  }
}

function cleanContext(raw: unknown): FeedbackContext {
  if (!isObject(raw)) return {};
  const out: FeedbackContext = {};
  if (raw.trust === "authenticated" || raw.trust === "known_host" || raw.trust === "anonymous") out.trust = raw.trust;
  if (isObject(raw.client)) out.client = raw.client as FeedbackContext["client"] & object;
  if (isObject(raw.user)) out.user = raw.user as UserContext;
  if (isObject(raw.app)) out.app = raw.app as AppContext;
  if (isObject(raw.flags)) out.flags = raw.flags as Flags;
  if (isObject(raw.context)) out.context = raw.context as Props;
  return out;
}

export function createFeedbackHandler<T = unknown>(opts: FeedbackHandlerOptions<T>): FeedbackHandler<T> {
  const resolved = resolveToolOptions(opts); // throws on bad configuration, at setup time
  const tool = feedbackTool(opts);
  const instructions = feedbackInstructions(opts);
  const timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const sdk = { name: "@mostlovedproduct/mcp", version: MCP_VERSION };
  const profile: Profile = resolved.profile;

  function buildReport(args: FeedbackArgs, ctx: FeedbackContext | undefined): Parameters<ReturnType<typeof createClient>["submit"]>[0] {
    const source: Partial<Source> = { kind: "agent", surface: "mcp" };
    if (args.requested_by_user !== undefined) source.requested_by_user = args.requested_by_user;
    if (ctx?.trust) source.trust = ctx.trust;
    if (ctx?.client) source.client = ctx.client;

    // Our own comparison keys go last and always fit within the Props key limit.
    const custom = Object.entries(ctx?.context ?? {}).slice(0, PROPS_MAX_KEYS - 2);
    const context: Props = { ...Object.fromEntries(custom), mlp_wording: WORDING_VERSION, mlp_profile: profile };

    const report: Parameters<ReturnType<typeof createClient>["submit"]>[0] = {
      source,
      kind: args.kind,
      impact: args.impact,
      summary: args.summary,
      task: args.goal,
      context,
    };
    if (args.actual !== undefined) report.actual = args.actual;
    if (args.expected !== undefined) report.expected = args.expected;
    if (args.suggestion !== undefined) report.suggestion = args.suggestion;
    if (args.tool) report.subject = { type: "tool", name: args.tool };
    if (ctx?.user) report.user = ctx.user;
    if (ctx?.app) report.app = ctx.app;
    if (ctx?.flags) report.flags = ctx.flags;
    return report;
  }

  async function run(args: unknown, callInfo: T | undefined, start: number): Promise<FeedbackOutcome> {
    const elapsed = () => Date.now() - start;
    const remaining = () => timeoutMs - elapsed();

    if (opts.enabled) {
      const enabledFn = opts.enabled;
      const r = await capped(() => enabledFn(), remaining());
      // Fails closed: a throwing or hanging kill switch means "off".
      if (!r.ok || r.value !== true) return { status: "failed", reason: "disabled", durationMs: elapsed() };
    }

    const v = validateArgs(args);
    if (!v.ok) return { status: "invalid", field: v.field, message: v.message, durationMs: elapsed() };
    const a = v.value;
    const meta = { kind: a.kind, ...(a.tool ? { tool: a.tool } : {}) };

    let ctx: FeedbackContext | undefined;
    if (opts.context) {
      const contextFn = opts.context;
      const r = await capped(() => contextFn(callInfo as T), Math.min(CONTEXT_TIMEOUT_MS, remaining()));
      if (r.ok && r.value) ctx = cleanContext(r.value);
    }

    const send = async (c: FeedbackContext | undefined) => {
      const budget = remaining();
      if (budget <= 0) return { ok: false as const, error: { code: "timeout", message: "out of time", retryable: true } satisfies ClientError };
      const client = createClient({
        key: opts.key,
        capture: "mcp-feedback",
        endpoint: opts.endpoint ?? DEFAULT_ENDPOINT,
        ...(opts.fallbackEndpoint ? { fallbackEndpoint: opts.fallbackEndpoint } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        timeoutMs: budget,
        sdk,
      });
      return client.submit(buildReport(a, c) as Omit<Report, "source"> & { source?: Partial<Source> }, { followUps: 0 });
    };

    let res = await send(ctx);
    // Server-supplied context that the API rejects must not cost us the report.
    if (!res.ok && ctx && (res.error.code === "invalid_input" || res.error.code === "invalid_payload")) {
      res = await send(undefined);
    }
    if (res.ok) return { status: "recorded", reportId: res.reportId, duplicate: res.duplicate, ...meta, durationMs: elapsed() };
    return { status: "failed", reason: failureReason(res.error), error: res.error, ...meta, durationMs: elapsed() };
  }

  function toResult(o: FeedbackOutcome): FeedbackCallResult {
    if (o.status === "recorded") {
      return {
        content: text(fill(RESULT_TEXTS.success, { Product: resolved.product, report_id: o.reportId })),
        structuredContent: { recorded: true, report_id: o.reportId },
        isError: false,
      };
    }
    if (o.status === "invalid") {
      return {
        content: text(`Invalid arguments: \`${o.field}\` ${o.message}. Correct it and call ${resolved.name} once more, or skip it.`),
        isError: true,
      };
    }
    return { content: text(RESULT_TEXTS.failure), structuredContent: { recorded: false }, isError: false };
  }

  async function call(args: unknown, callInfo?: T): Promise<FeedbackCallResult> {
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<FeedbackOutcome>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: "failed", reason: "timeout", durationMs: Date.now() - start }),
        timeoutMs + CALL_MARGIN_MS,
      );
    });
    let outcome: FeedbackOutcome;
    try {
      outcome = await Promise.race([run(args, callInfo, start), guard]);
    } catch {
      outcome = { status: "failed", reason: "internal", durationMs: Date.now() - start };
    } finally {
      clearTimeout(timer);
    }
    if (opts.onResult) {
      try {
        const p = opts.onResult(outcome, callInfo);
        if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
      } catch {
        /* the server's own hook must never affect the task */
      }
    }
    return toResult(outcome);
  }

  return { tool, call, instructions };
}
