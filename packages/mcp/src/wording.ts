import mcpTool from "./i18n/en-US.json";

export const WORDING_VERSION = "2026-11-18";

export type Profile = "proactive" | "conservative";
export const PROFILES: readonly Profile[] = ["proactive", "conservative"];

/** Description templates. `{Product}` is the only substitution. */
export const DESCRIPTIONS: Record<Profile, string> = mcpTool.descriptions;

export const TITLE_TEMPLATE = mcpTool.title;

export const FIELD_NAMES = [
  "kind",
  "summary",
  "goal",
  "impact",
  "tool",
  "actual",
  "expected",
  "suggestion",
  "requested_by_user",
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** Field descriptions shown to the model. `{Product}` is substituted. */
export const FIELD_DESCRIPTIONS: Record<FieldName, string> = mcpTool.fields;

/** Schema constraints, shared by the JSON Schema, the hand validator and the zod adapter. */
export const KIND_VALUES = ["broken", "confusing", "missing", "idea"] as const;
export const IMPACT_VALUES = ["blocked", "worked_around", "friction"] as const;
export const LIMITS_MCP = {
  summary: { min: 10, max: 300 },
  goal: { min: 10, max: 500 },
  tool: { max: 200 },
  actual: { max: 1000 },
  expected: { max: 1000 },
  suggestion: { max: 500 },
} as const;
export const EXTRA_GUIDANCE_MAX = 300;
export const DEFAULT_TOOL_NAME = "submit_feedback";
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;

/** Result texts. */
export const RESULT_TEXTS = mcpTool.results;

/** Server instructions line (proactive only). `{tool}` is the registered tool name. */
export const INSTRUCTIONS_TEMPLATE =
  "If a {Product} tool fails, misleads you or lacks something the task needs, you can tell the {Product} team with {tool} after finishing the affected step.";

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(Product|report_id|tool)\}/g, (m, k: string) => vars[k] ?? m);
}
