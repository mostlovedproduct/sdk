import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createFeedbackHandler, type FeedbackHandler, type FeedbackHandlerOptions } from "./handler.js";
import { fieldDescription, resolveToolOptions } from "./tool.js";
import { IMPACT_VALUES, KIND_VALUES, LIMITS_MCP } from "./wording.js";

/** What the official SDK passes to a tool callback; it is the `callInfo` your `context()` receives. */
export type McpRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The zod form of the tool's input schema, with the same constraints and descriptions as `feedbackTool().inputSchema`. */
export function feedbackZodSchema(product: string) {
  const d = (f: Parameters<typeof fieldDescription>[0]) => fieldDescription(f, product);
  return z.strictObject({
    kind: z.enum(KIND_VALUES).describe(d("kind")),
    summary: z.string().min(LIMITS_MCP.summary.min).max(LIMITS_MCP.summary.max).describe(d("summary")),
    goal: z.string().min(LIMITS_MCP.goal.min).max(LIMITS_MCP.goal.max).describe(d("goal")),
    impact: z.enum(IMPACT_VALUES).describe(d("impact")),
    tool: z.string().max(LIMITS_MCP.tool.max).describe(d("tool")).optional(),
    actual: z.string().max(LIMITS_MCP.actual.max).describe(d("actual")).optional(),
    expected: z.string().max(LIMITS_MCP.expected.max).describe(d("expected")).optional(),
    suggestion: z.string().max(LIMITS_MCP.suggestion.max).describe(d("suggestion")).optional(),
    requested_by_user: z.boolean().describe(d("requested_by_user")).optional(),
  });
}

/**
 * Register the feedback tool on an official-SDK `McpServer` (`server.registerTool`).
 * Returns the handler, e.g. to read `handler.instructions` for the server's `instructions`.
 */
export function registerFeedbackTool(
  server: McpServer,
  opts: FeedbackHandlerOptions<McpRequestExtra>,
): FeedbackHandler<McpRequestExtra> {
  const handler = createFeedbackHandler<McpRequestExtra>(opts);
  const { product } = resolveToolOptions(opts);
  const { name, title, description, annotations } = handler.tool;
  server.registerTool(
    name,
    { title, description, inputSchema: feedbackZodSchema(product), annotations: { ...annotations } },
    async (args, extra) => handler.call(args, extra),
  );
  return handler;
}

export type { FeedbackHandler, FeedbackHandlerOptions } from "./handler.js";
