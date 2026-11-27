import {
  DEFAULT_TOOL_NAME,
  DESCRIPTIONS,
  EXTRA_GUIDANCE_MAX,
  FIELD_DESCRIPTIONS,
  IMPACT_VALUES,
  INSTRUCTIONS_TEMPLATE,
  KIND_VALUES,
  LIMITS_MCP,
  PROFILES,
  TITLE_TEMPLATE,
  TOOL_NAME_RE,
  fill,
  type FieldName,
  type Profile,
} from "./wording.js";

export interface FeedbackToolOptions {
  /** Product name as customers' users know it. Substituted for `{Product}`. */
  product: string;
  /** `proactive` (default) for developer products and coding agents; `conservative` for consumer hosts. */
  profile?: Profile;
  /** Override for flat-namespace hosts, e.g. `submit_acme_feedback`. `^[a-z][a-z0-9_]{2,63}$`. */
  name?: string;
  /** One product-specific sentence or two, appended as a final paragraph. At most 300 characters. */
  extraGuidance?: string;
}

export interface ResolvedToolOptions {
  product: string;
  profile: Profile;
  name: string;
  extraGuidance: string | undefined;
}

export interface JsonSchemaProperty {
  type: "string" | "boolean";
  description: string;
  enum?: readonly string[];
  minLength?: number;
  maxLength?: number;
}

export interface FeedbackInputSchema {
  type: "object";
  properties: Record<FieldName, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

export interface FeedbackToolAnnotations {
  readOnlyHint: false;
  destructiveHint: false;
  idempotentHint: false;
  openWorldHint: false;
}

export interface FeedbackToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: FeedbackInputSchema;
  annotations: FeedbackToolAnnotations;
}

export function resolveToolOptions(opts: FeedbackToolOptions): ResolvedToolOptions {
  if (typeof opts !== "object" || opts === null) throw new TypeError("@mostlovedproduct/mcp: options are required");
  const product = typeof opts.product === "string" ? opts.product.trim() : "";
  if (!product) throw new TypeError("@mostlovedproduct/mcp: `product` is required");
  if (product.length > 80 || /[\r\n]/.test(product)) {
    throw new TypeError("@mostlovedproduct/mcp: `product` must be a single line of at most 80 characters");
  }
  const profile = opts.profile ?? "proactive";
  if (!PROFILES.includes(profile)) throw new TypeError(`@mostlovedproduct/mcp: unknown profile "${String(profile)}"`);
  const name = opts.name ?? DEFAULT_TOOL_NAME;
  if (typeof name !== "string" || !TOOL_NAME_RE.test(name)) {
    throw new TypeError(`@mostlovedproduct/mcp: tool name must match ${TOOL_NAME_RE.source}`);
  }
  let extraGuidance: string | undefined;
  if (opts.extraGuidance !== undefined) {
    if (typeof opts.extraGuidance !== "string") throw new TypeError("@mostlovedproduct/mcp: `extraGuidance` must be a string");
    const g = opts.extraGuidance.trim();
    if (g.length > EXTRA_GUIDANCE_MAX) {
      throw new RangeError(`@mostlovedproduct/mcp: \`extraGuidance\` must be at most ${EXTRA_GUIDANCE_MAX} characters (got ${g.length})`);
    }
    if (g) extraGuidance = g;
  }
  return { product, profile, name, extraGuidance };
}

export function toolDescription(o: ResolvedToolOptions): string {
  const body = fill(DESCRIPTIONS[o.profile], { Product: o.product });
  return o.extraGuidance ? `${body}\n\n${o.extraGuidance}` : body;
}

export function fieldDescription(field: FieldName, product: string): string {
  return fill(FIELD_DESCRIPTIONS[field], { Product: product });
}

/** The tool definition: plain JSON Schema, no `oneOf`, no `$ref`. Returns a fresh object each call. */
export function feedbackTool(opts: FeedbackToolOptions): FeedbackToolDefinition {
  const o = resolveToolOptions(opts);
  const d = (f: FieldName) => fieldDescription(f, o.product);
  return {
    name: o.name,
    title: fill(TITLE_TEMPLATE, { Product: o.product }),
    description: toolDescription(o),
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...KIND_VALUES], description: d("kind") },
        summary: { type: "string", minLength: LIMITS_MCP.summary.min, maxLength: LIMITS_MCP.summary.max, description: d("summary") },
        goal: { type: "string", minLength: LIMITS_MCP.goal.min, maxLength: LIMITS_MCP.goal.max, description: d("goal") },
        impact: { type: "string", enum: [...IMPACT_VALUES], description: d("impact") },
        tool: { type: "string", maxLength: LIMITS_MCP.tool.max, description: d("tool") },
        actual: { type: "string", maxLength: LIMITS_MCP.actual.max, description: d("actual") },
        expected: { type: "string", maxLength: LIMITS_MCP.expected.max, description: d("expected") },
        suggestion: { type: "string", maxLength: LIMITS_MCP.suggestion.max, description: d("suggestion") },
        requested_by_user: { type: "boolean", description: d("requested_by_user") },
      },
      required: ["kind", "summary", "goal", "impact"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  };
}

/** One line for the server's `instructions`. Empty string for the conservative profile. */
export function feedbackInstructions(opts: FeedbackToolOptions): string {
  const o = resolveToolOptions(opts);
  if (o.profile === "conservative") return "";
  return fill(INSTRUCTIONS_TEMPLATE, { Product: o.product, tool: o.name });
}
