import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { feedbackTool } from "../src/index.js";
import { registerFeedbackTool, type McpRequestExtra } from "../src/sdk.js";
import { FAILURE_TEXT, REPORT_ID, SUCCESS_TEXT, VALID_ARGS, json, mockFetch, skKey } from "./helpers.js";

async function connect(opts: Partial<Parameters<typeof registerFeedbackTool>[1]> = {}, behavior?: Parameters<typeof mockFetch>[0]) {
  const m = mockFetch(behavior);
  const server = new McpServer({ name: "acme", version: "1.0.0" });
  const handler = registerFeedbackTool(server, { key: skKey(), product: "Acme", fetch: m.fetch, ...opts });
  const client = new Client({ name: "test-host", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { server, client, handler, ...m };
}

type Schema = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: unknown;
};

describe("official SDK adapter", () => {
  it("emits a JSON Schema equivalent to feedbackTool().inputSchema", async () => {
    const { client } = await connect();
    const listed = (await client.listTools()).tools.find((t) => t.name === "submit_feedback")!;
    const mine = feedbackTool({ product: "Acme" });
    const theirs = listed.inputSchema as unknown as Schema;

    expect(listed.title).toBe(mine.title);
    expect(listed.description).toBe(mine.description);
    expect(listed.annotations).toEqual(mine.annotations);
    expect(theirs.additionalProperties).toBe(false);
    expect([...(theirs.required ?? [])].sort()).toEqual([...mine.inputSchema.required].sort());
    expect(Object.keys(theirs.properties).sort()).toEqual(Object.keys(mine.inputSchema.properties).sort());
    for (const [name, prop] of Object.entries(mine.inputSchema.properties)) {
      const t = theirs.properties[name]!;
      expect(t.type, name).toBe(prop.type);
      expect(t.description, name).toBe(prop.description);
      expect(t.enum, name).toEqual(prop.enum);
      expect(t.minLength, name).toBe(prop.minLength);
      expect(t.maxLength, name).toBe(prop.maxLength);
    }
  });

  it("end to end: a real client calls the tool through the adapter", async () => {
    const { client, sent } = await connect({
      context: (extra: McpRequestExtra) => ({ trust: "known_host", client: { name: "test-host" }, context: { has_signal: !!extra.signal } }),
    });
    const result = await client.callTool({ name: "submit_feedback", arguments: { ...VALID_ARGS, requested_by_user: true } });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: SUCCESS_TEXT(REPORT_ID) }]);
    expect(result.structuredContent).toEqual({ recorded: true, report_id: REPORT_ID });
    expect(sent).toHaveLength(1);
    const rep = sent[0]!.envelope.report!;
    expect(rep.source).toEqual({ kind: "agent", surface: "mcp", requested_by_user: true, trust: "known_host", client: { name: "test-host" } });
    expect(rep.context).toMatchObject({ has_signal: true, mlp_profile: "proactive" });
    expect(rep.subject).toEqual({ type: "tool", name: "search_orders" });
  });

  it("end to end: backend failure is a harmless result", async () => {
    const { client } = await connect({}, () => json(429, { error: { code: "rate_limited", message: "x", retryable: true } }));
    const result = await client.callTool({ name: "submit_feedback", arguments: VALID_ARGS });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: FAILURE_TEXT }]);
    expect(result.structuredContent).toEqual({ recorded: false });
  });

  it("end to end: invalid args and model-supplied trust are rejected without sending", async () => {
    const { client, sent } = await connect();
    const bad = await client.callTool({ name: "submit_feedback", arguments: { ...VALID_ARGS, kind: "nope" } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("kind");
    const smuggled = await client.callTool({ name: "submit_feedback", arguments: { ...VALID_ARGS, trust: "authenticated" } });
    expect(smuggled.isError).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("name override and conservative profile flow through", async () => {
    const { client, handler } = await connect({ name: "submit_acme_feedback", profile: "conservative" });
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual(["submit_acme_feedback"]);
    expect(tools[0]!.description).toBe(feedbackTool({ product: "Acme", profile: "conservative", name: "submit_acme_feedback" }).description);
    expect(handler.instructions).toBe("");
  });

  it("the handler's instructions can feed the server instructions", () => {
    const m = mockFetch();
    const server = new McpServer({ name: "acme", version: "1" });
    const handler = registerFeedbackTool(server, { key: skKey(), product: "Acme", fetch: m.fetch });
    expect(handler.instructions).toMatch(/^If a Acme tool fails/);
  });
});
