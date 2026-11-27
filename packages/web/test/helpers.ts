import { CAPTURE_STREAM_TYPE, captureFrame, type Receipt } from "@mostlovedproduct/core/protocol";
import type { FollowUpId } from "../src/types.js";

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const KEY = `mlp_pk_${b64url(JSON.stringify({ k: "k1", j: "j1", t: "ten", p: "proj" }))}.c2ln`;

export interface Call {
  url: string;
  body: any;
}

type Res = { status?: number; body?: unknown; delay?: number };
type Reply = Res | ((call: Call) => Res);

export function followUp(id: FollowUpId, input: "choice" | "text" = "choice", options?: { id: string; label: string }[]) {
  return {
    id,
    question: `Q:${id}`,
    input,
    ...(input === "choice" ? { options: options ?? [{ id: "blocked", label: "It stopped me" }, { id: "friction", label: "Minor annoyance" }] } : {}),
    reply_token: `tok_${id}`,
    expires_at: new Date(Date.now() + 1800_000).toISOString(),
  };
}

/** A fetch stub. Each reply is consumed in order; the last one repeats. Receipts echo the envelope id. */
export function mockFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const call = { url, body };
    calls.push(call);
    const r = replies[Math.min(i++, replies.length - 1)] ?? {};
    const res: Res = typeof r === "function" ? r(call) : r;
    if (res.delay) await new Promise((ok) => setTimeout(ok, res.delay));
    const reportId = body.type === "report" ? body.id : body.answer.report_id;
    const payload = res.body ?? { report_id: reportId, status: "captured", duplicate: false, message: "ok" };
    const status = res.status ?? 202;
    if (status === 0) throw new TypeError("Failed to fetch");
    if (body.type === "report" && status === 202) {
      const { follow_up, ...receipt } = payload as Receipt;
      return new Response(new Blob([captureFrame("captured", receipt), ...(follow_up ? [captureFrame("follow_up", follow_up)] : [])]), {
        status, headers: { "Content-Type": CAPTURE_STREAM_TYPE },
      });
    }
    return new Response(JSON.stringify(payload), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

/** A 202 receipt with a follow-up for the report being sent. */
export const withFollowUp =
  (f: ReturnType<typeof followUp>) =>
  (call: Call) => ({
    body: {
      report_id: call.body.type === "report" ? call.body.id : call.body.answer.report_id,
      status: "captured",
      duplicate: false,
      message: "ok",
      follow_up: f,
    },
  });

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
