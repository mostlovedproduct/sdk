import { FIELD_NAMES, IMPACT_VALUES, KIND_VALUES, LIMITS_MCP } from "./wording.js";

export interface FeedbackArgs {
  kind: (typeof KIND_VALUES)[number];
  summary: string;
  goal: string;
  impact: (typeof IMPACT_VALUES)[number];
  tool?: string;
  actual?: string;
  expected?: string;
  suggestion?: string;
  requested_by_user?: boolean;
}

export type ValidationResult = { ok: true; value: FeedbackArgs } | { ok: false; field: string; message: string };

const codePoints = (s: string) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

type StringRule = { min?: number; max?: number };
const STRING_FIELDS: Record<string, StringRule> = {
  summary: LIMITS_MCP.summary,
  goal: LIMITS_MCP.goal,
  tool: LIMITS_MCP.tool,
  actual: LIMITS_MCP.actual,
  expected: LIMITS_MCP.expected,
  suggestion: LIMITS_MCP.suggestion,
};
const REQUIRED = ["kind", "summary", "goal", "impact"] as const;

/** Hand validation against the tool's input schema (no validation library). Reports the first problem. */
export function validateArgs(args: unknown): ValidationResult {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, field: "arguments", message: "arguments must be an object" };
  }
  const a = args as Record<string, unknown>;
  for (const k of Object.keys(a)) {
    if (!(FIELD_NAMES as readonly string[]).includes(k)) {
      return { ok: false, field: k, message: `unknown argument "${k}"` };
    }
  }
  for (const f of REQUIRED) {
    if (a[f] === undefined) return { ok: false, field: f, message: "is required" };
  }
  const out: Record<string, unknown> = {};
  for (const f of FIELD_NAMES) {
    const v = a[f];
    if (v === undefined) continue;
    if (f === "kind" || f === "impact") {
      const allowed: readonly string[] = f === "kind" ? KIND_VALUES : IMPACT_VALUES;
      if (typeof v !== "string" || !allowed.includes(v)) {
        return { ok: false, field: f, message: `must be one of ${allowed.join(", ")}` };
      }
    } else if (f === "requested_by_user") {
      if (typeof v !== "boolean") return { ok: false, field: f, message: "must be a boolean" };
    } else {
      const rule = STRING_FIELDS[f]!;
      if (typeof v !== "string") return { ok: false, field: f, message: "must be a string" };
      const len = codePoints(v);
      // Blank text does not count towards a minimum.
      if (rule.min !== undefined && codePoints(v.trim()) < rule.min) {
        return { ok: false, field: f, message: `must be at least ${rule.min} characters` };
      }
      if (rule.max !== undefined && len > rule.max) {
        return { ok: false, field: f, message: `must be at most ${rule.max} characters (got ${len})` };
      }
    }
    out[f] = v;
  }
  return { ok: true, value: out as unknown as FeedbackArgs };
}
