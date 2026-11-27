import type { Envelope } from "@mostlovedproduct/core/protocol";

/** Opaque credential for the mocked intake endpoint. */
export function skKey(): string {
  return "test-server-key";
}

export const REPORT_ID = "01900000-0000-7000-8000-000000000001";

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function receipt(over: Record<string, unknown> = {}): Response {
  return json(202, { report_id: REPORT_ID, status: "captured", duplicate: false, message: "Captured", ...over });
}

export interface Sent {
  url: string;
  init: RequestInit;
  envelope: Envelope;
}

export type FetchBehavior = (url: string, init: RequestInit) => Response | Promise<Response> | "hang" | "hang-ignore-signal";

/** A recording fetch mock. `hang` honours the abort signal; `hang-ignore-signal` never settles. */
export function mockFetch(behavior: FetchBehavior = () => receipt()) {
  const sent: Sent[] = [];
  const fn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    sent.push({ url, init, envelope: JSON.parse(String(init.body)) as Envelope });
    const r = behavior(url, init);
    if (r === "hang-ignore-signal") return new Promise<Response>(() => {});
    if (r === "hang") {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    return Promise.resolve(r);
  }) as typeof fetch;
  return { fetch: fn, sent };
}

export const VALID_ARGS = {
  kind: "broken",
  summary: "search_orders returns an empty list when status is refunded",
  goal: "Looking up refunded orders for a customer.",
  impact: "worked_around",
  tool: "search_orders",
  actual: "Returned {orders: []} although the order exists.",
  expected: "The refunded order in the list.",
  suggestion: "Include refunded orders when status filter says so.",
} as const;

export const SUCCESS_TEXT = (id: string, product = "Acme") =>
  `Recorded for the ${product} team (ref ${id}). Continue with the user's task. Nothing else is needed and you should not call this tool again for the same problem.`;
export const FAILURE_TEXT = "The report could not be recorded right now. That's fine: continue with the user's task and do not retry.";
