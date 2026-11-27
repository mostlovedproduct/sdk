import { describe, expect, it } from "vitest";
import { createFeedbackHandler } from "../src/index.js";
import { REPORT_ID, SUCCESS_TEXT, VALID_ARGS, mockFetch, skKey } from "./helpers.js";

/**
 * A hand-written, stateless JSON-RPC MCP server in the style of a Cloudflare Worker,
 * wired with only the root entry of @mostlovedproduct/mcp (no MCP SDK, no zod).
 */
function makeWorker(fetchImpl: typeof fetch) {
  const feedback = createFeedbackHandler<{ signedIn: boolean }>({
    key: skKey(),
    product: "Acme",
    fetch: fetchImpl,
    context: (c) => ({ trust: c.signedIn ? "authenticated" : "anonymous" }),
  });
  const ownTools = [{ name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} } }];

  return async function handle(request: Request): Promise<Response> {
    const msg = (await request.json()) as { id?: number; method: string; params?: Record<string, unknown> };
    const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize":
        return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "acme", version: "1" }, instructions: feedback.instructions });
      case "tools/list":
        return reply({ tools: [...ownTools, feedback.tool] });
      case "tools/call": {
        const p = msg.params as { name: string; arguments?: unknown };
        if (p.name === feedback.tool.name) {
          return reply(await feedback.call(p.arguments, { signedIn: request.headers.has("authorization") }));
        }
        return reply({ content: [{ type: "text", text: "pong" }] });
      }
      default:
        return Response.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
    }
  };
}

const rpc = (method: string, params?: unknown, headers: Record<string, string> = {}) =>
  new Request("https://mcp.acme.test/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });

describe("hand-rolled JSON-RPC server using only the root entry", () => {
  it("tools/list advertises the tool; the definition is JSON-serialisable", async () => {
    const m = mockFetch();
    const res = await makeWorker(m.fetch)(rpc("tools/list"));
    const { result } = (await res.json()) as { result: { tools: Array<Record<string, any>> } };
    const t = result.tools.find((x) => x.name === "submit_feedback")!;
    expect(t.title).toBe("Send feedback to the Acme team");
    expect(t.inputSchema.additionalProperties).toBe(false);
    expect(t.inputSchema.required).toEqual(["kind", "summary", "goal", "impact"]);
    expect(t.annotations.readOnlyHint).toBe(false);
  });

  it("initialize carries the one-line instructions", async () => {
    const res = await makeWorker(mockFetch().fetch)(rpc("initialize"));
    const { result } = (await res.json()) as { result: { instructions: string } };
    expect(result.instructions).toContain("submit_feedback");
  });

  it("tools/call files a report with server-side trust", async () => {
    const m = mockFetch();
    const res = await makeWorker(m.fetch)(rpc("tools/call", { name: "submit_feedback", arguments: VALID_ARGS }, { authorization: "Bearer x" }));
    const { result } = (await res.json()) as { result: any };
    expect(result.content[0].text).toBe(SUCCESS_TEXT(REPORT_ID));
    expect(result.structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
    expect(m.sent[0]!.envelope.report!.source).toMatchObject({ kind: "agent", surface: "mcp", trust: "authenticated" });
  });

  it("the root entry source imports neither the MCP SDK nor zod", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = new URL("../src/", import.meta.url);
    for (const f of (await readdir(dir)).filter((f) => f.endsWith(".ts") && f !== "sdk.ts")) {
      const src = await readFile(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/from\s+["'](@modelcontextprotocol|zod)/);
      expect(src, f).not.toMatch(/from\s+["']node:/);
    }
  });
});
