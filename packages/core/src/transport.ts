/** One-attempt-per-endpoint transport with a shared deadline and a single failover. */

import { CAPTURE_PATHS, LIMITS, type ErrorCode, type FollowUp, type Receipt } from "./protocol/types.js";
import { CAPTURE_STREAM_TYPE, readCaptureFrames } from "./protocol/capture-stream.js";
import type { ClientError } from "./types.js";

export interface TransportConfig {
  key: string;
  endpoints: string[];
  fetch: typeof fetch;
}

export type PostOutcome =
  | { ok: true; status: number; body: unknown; endpointIndex: number }
  | { ok: false; error: ClientError };

type Attempt =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "network"; message: string }
  | { kind: "timeout" }
  | { kind: "aborted" };

interface CaptureHooks {
  onCaptured?: (receipt: Receipt) => void;
  onFollowUpPending?: () => void;
}

/** Primary budget: everything except the fallback reserve; split evenly when the total is too small to reserve 1.5 s. */
export function primaryBudget(remaining: number): number {
  const reserve = LIMITS.sdkFallbackReserveMs;
  return remaining >= reserve * 2 ? remaining - reserve : remaining / 2;
}

async function attempt(
  cfg: TransportConfig,
  url: string,
  body: string,
  budgetMs: number,
  signal: AbortSignal | undefined,
  streamed: boolean,
  hooks?: CaptureHooks,
): Promise<Attempt> {
  if (signal?.aborted) return { kind: "aborted" };
  if (budgetMs <= 0) return { kind: "timeout" };
  const controller = new AbortController();
  let accepted: { kind: "response"; status: number; body: Receipt } | undefined;
  // Resolves when the attempt is cut short, so a fetch that ignores its signal cannot outlive the budget.
  let cut!: (a: Attempt) => void;
  const cutShort = new Promise<Attempt>((resolve) => (cut = resolve));
  const timer = setTimeout(() => {
    cut(accepted ?? { kind: "timeout" });
    controller.abort();
  }, budgetMs);
  const onAbort = () => {
    cut(accepted ?? { kind: "aborted" });
    controller.abort();
  };
  signal?.addEventListener("abort", onAbort);
  const work = (async (): Promise<Attempt> => {
    const res = await cfg.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        ...(streamed ? { Accept: CAPTURE_STREAM_TYPE } : {}),
      },
      body,
      signal: controller.signal,
    });
    if (streamed && res.ok) {
      if (!res.body || res.headers.get("Content-Type")?.split(";")[0]?.trim() !== CAPTURE_STREAM_TYPE) {
        void res.body?.cancel().catch(() => {});
        return { kind: "network", message: "Invalid capture stream" };
      }
      let questionPending = false;
      for await (const frame of readCaptureFrames(res.body, controller.signal)) {
        if (controller.signal.aborted) break;
        if (frame.event === "captured" && !accepted) {
          const receipt = frame.data as Partial<Receipt> | null;
          if (receipt?.status !== "captured" || typeof receipt.report_id !== "string" ||
              typeof receipt.duplicate !== "boolean" || typeof receipt.message !== "string") break;
          const { report_id, status, duplicate, message } = receipt;
          accepted = { kind: "response", status: res.status, body: { report_id, status, duplicate, message } };
          hooks?.onCaptured?.(accepted.body);
        } else if (frame.event === "follow_up_pending" && accepted && !questionPending) {
          questionPending = true;
          hooks?.onFollowUpPending?.();
        } else if (frame.event === "follow_up" && accepted) {
          accepted.body.follow_up = frame.data as FollowUp;
          break;
        }
      }
      return accepted ?? { kind: "network", message: "Capture stream closed before the receipt" };
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    return { kind: "response", status: res.status, body: parsed };
  })().catch((err: unknown): Attempt => accepted ?? { kind: "network", message: err instanceof Error ? err.message : String(err) });
  try {
    // A cut always wins over the abort-induced rejection of `work`, because `cut` runs before `abort()`.
    return await Promise.race([cutShort, work]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const STATUS_CODE: Record<number, ErrorCode> = {
  400: "invalid_payload",
  401: "unauthorized",
  403: "forbidden_origin",
  409: "conflict",
  410: "follow_up_expired",
  413: "payload_too_large",
  429: "rate_limited",
};

function httpError(status: number, body: unknown): ClientError {
  const e = (body as { error?: Record<string, unknown> } | undefined)?.error;
  // Known codes are the mapped ones plus "unavailable" (keeps the protocol's ERROR_CODES list out of browser bundles).
  const bodyCode =
    typeof e?.code === "string" && (e.code === "unavailable" || Object.values(STATUS_CODE).includes(e.code as ErrorCode))
      ? (e.code as ErrorCode)
      : undefined;
  const code: ErrorCode = bodyCode ?? (status >= 500 ? "unavailable" : (STATUS_CODE[status] ?? "invalid_payload"));
  const out: ClientError = {
    code,
    message: typeof e?.message === "string" ? e.message : `Request failed with status ${status}`,
    retryable: typeof e?.retryable === "boolean" ? e.retryable : status === 429 || status >= 500,
    status,
  };
  if (typeof e?.field === "string") out.field = e.field;
  if (typeof e?.retry_after === "number") out.retryAfter = e.retry_after;
  return out;
}

function attemptError(a: Exclude<Attempt, { kind: "response" }>): ClientError {
  switch (a.kind) {
    case "timeout":
      return { code: "timeout", message: "The request timed out", retryable: true };
    case "aborted":
      return { code: "network", message: "The request was aborted by the caller", retryable: false };
    case "network":
      return { code: "network", message: `Network error: ${a.message}`, retryable: true };
  }
}

/**
 * POST `body` to `path` on each endpoint in order, at most once each, within `deadline` (epoch ms).
 * Fails over only on network error, timeout or 5xx. The body string is identical on every attempt.
 */
export async function post(
  cfg: TransportConfig,
  path: string,
  body: string,
  deadline: number,
  signal: AbortSignal | undefined,
  hooks?: CaptureHooks,
): Promise<PostOutcome> {
  let last: ClientError = { code: "timeout", message: "The request timed out", retryable: true };
  for (let i = 0; i < cfg.endpoints.length; i++) {
    const remaining = deadline - Date.now();
    const isLast = i === cfg.endpoints.length - 1;
    const budget = isLast ? remaining : primaryBudget(remaining);
    const a = await attempt(cfg, cfg.endpoints[i] + path, body, budget, signal, path === CAPTURE_PATHS.userFeedback, hooks);
    if (a.kind === "response") {
      if (a.status >= 200 && a.status < 300) return { ok: true, status: a.status, body: a.body, endpointIndex: i };
      last = httpError(a.status, a.body);
      if (a.status < 500) return { ok: false, error: last };
    } else {
      last = attemptError(a);
      if (a.kind === "aborted") return { ok: false, error: last };
    }
  }
  return { ok: false, error: last };
}
