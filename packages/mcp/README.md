# @mostlovedproduct/mcp

Give the agents that use your MCP server a way to tell you what is broken, confusing or missing: one tool, `submit_feedback`, with wording that is identical across customers and measured against models.

- Root entry `@mostlovedproduct/mcp`: tool definition (plain JSON Schema) and handler. Depends only on `@mostlovedproduct/core`, uses `fetch` only, works on Cloudflare Workers. No MCP SDK, no zod.
- `@mostlovedproduct/mcp/sdk`: one-call adapter for the official `@modelcontextprotocol/sdk` (`McpServer`). Needs the SDK and `zod` ^4, which you already have if you use it.

A feedback failure never harms the task: `call()` never throws, never takes longer than `timeoutMs` (default 3 s) plus a small margin, and on any failure returns a normal result telling the model to continue and not retry.

## Setup

1. Create a **server capture key** (`mlp_sk_...`) in the dashboard and store it as a secret, for example `MLP_SERVER_KEY`. Never ship it to a browser.
2. `npm i @mostlovedproduct/mcp`
3. Add the tool (below).
4. Pick a profile. Use `conservative` for anything listed in a consumer directory.
5. Give it its own kill switch and rate-limit bucket.
6. Update your privacy notice before production traffic (template below).
7. Verify: call the tool once from an MCP inspector and look for the report in the dashboard.

Prefer to have your coding agent do it? See [One-prompt setup](#one-prompt-setup).

## Level 1: official SDK

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFeedbackTool } from "@mostlovedproduct/mcp/sdk";

const server = new McpServer({ name: "acme", version: "1.0.0" });

registerFeedbackTool(server, {
  key: process.env.MLP_SERVER_KEY!,
  product: "Acme",              // appears in the wording: "the Acme team"
  profile: "proactive",         // or "conservative"
});
```

`registerFeedbackTool` returns the handler; its `instructions` string is the optional level 3 line. The callback receives the SDK's request `extra`, which is what your `context(...)` function gets (see [Context and trust](#context-and-trust)).

## Level 2: hand-written JSON-RPC server (Cloudflare Workers)

No SDK needed. Add the definition to your `tools/list` result and route `tools/call` to `handler.call`:

```ts
import { createFeedbackHandler } from "@mostlovedproduct/mcp";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const feedback = createFeedbackHandler<{ signedIn: boolean }>({
      key: env.MLP_SERVER_KEY,
      product: "Acme",
      enabled: () => env.FEEDBACK_KILL_SWITCH !== "1",
      context: (call) => ({ trust: call.signedIn ? "authenticated" : "anonymous" }),
      onResult: (o) => console.log(JSON.stringify({ feedback: o.status, reason: "reason" in o ? o.reason : undefined })),
    });

    const msg = (await request.json()) as { id: number; method: string; params?: any };
    const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: msg.id, result });

    if (msg.method === "tools/list") return reply({ tools: [...myTools, feedback.tool] });
    if (msg.method === "tools/call" && msg.params.name === feedback.tool.name) {
      return reply(await feedback.call(msg.params.arguments, { signedIn: await isSignedIn(request) }));
    }
    // ... your own tools
    return Response.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  },
};
```

`feedback.tool` is `{ name, title, description, inputSchema, annotations }` with a plain JSON Schema (`additionalProperties: false`, no `oneOf`, no `$ref`), so it drops into any tool list. Build the handler once at module scope if you can; it is cheap either way.

## Level 3: server instructions (optional)

For hosts that surface server `instructions`, add one line. It is empty for the `conservative` profile.

```ts
import { feedbackInstructions } from "@mostlovedproduct/mcp";

const instructions = [yourInstructions, feedbackInstructions({ product: "Acme" })].filter(Boolean).join("\n\n");
```

## Choosing a profile

| Profile | Use for | When the model files |
|---------|---------|----------------------|
| `proactive` (default) | Developer and API products, coding agents, internal agents | On its own, after it hits a problem with your tools |
| `conservative` | Consumer hosts (ChatGPT, Claude apps) and anything under directory review | Only when the user asks, or a tool clearly failed and the user has been told |

If you can detect the host per request, build one handler per profile and choose per request. You can append one product-specific paragraph (at most 300 characters) with `extraGuidance`; you cannot replace the shared wording, because that is what gets measured. For flat-namespace hosts use `name: "submit_acme_feedback"` (`^[a-z][a-z0-9_]{2,63}$`).

## Context and trust

The model never supplies trust, identity or context: the tool has no such fields and unknown arguments are rejected. You attach them on the server side, per call:

```ts
createFeedbackHandler({
  key: env.MLP_SERVER_KEY,
  product: "Acme",
  context: (call) => ({
    trust: call.signedIn ? "authenticated" : call.knownHost ? "known_host" : "anonymous",
    client: { name: call.hostName },                 // agent host as you know it
    user: { id: call.opaqueUserId, tier: call.plan }, // your own opaque id, not an email
    app: { version: BUILD_SHA, env: "production" },
    flags: call.experiments,
    context: { region: call.region },
  }),
});
```

`context` runs on every call. If it throws or takes more than 500 ms, the report is still sent, without it. Every report also carries `mlp_wording` and `mlp_profile` in its `context` so results can be compared across wording versions.

## Kill switch and rate limits

- `enabled: () => boolean | Promise<boolean>` is checked on every call. When it returns false (or throws, or hangs) the tool replies with the harmless failure text and sends nothing. Wire it to a config flag you can flip without a deploy.
- Rate-limit the feedback tool on its own bucket, separate from your real tools, per user or per host. When your limiter says no, do not call `handler.call`; return the harmless failure result yourself (`{ content: [{ type: "text", text: RESULT_TEXTS.failure }], structuredContent: { recorded: false }, isError: false }`). A throttled feedback call must not look like a failed task.
- `onResult(outcome, callInfo)` is your hook for logs and metrics. It cannot throw into the call and is never awaited.

## Results the model sees

| Case | `isError` | Text |
|------|-----------|------|
| Recorded | false | `Recorded for the {Product} team (ref {report_id}). Continue with the user's task. ...` |
| Any failure (timeout, network, rate limit, kill switch) | false | `The report could not be recorded right now. That's fine: continue with the user's task and do not retry.` |
| Invalid arguments | true | Names the field so the model can correct a malformed call once |

## Privacy notice

Before production traffic, tell your users that assistants may send reports. Adapt this paragraph (it is a starting point, not legal advice; have it reviewed):

> **Reports from assistants.** An assistant using [Product] can send us a short report when something goes wrong or is missing, for example a search that returned nothing it should have. It may do this when you ask, or when it cannot complete a task. Your assistant app may or may not ask you first, and reporting does not require an account.
>
> A report describes the task, what happened, and which [Product] tool was involved. It can also identify the assistant app and whether the request came through a signed-in account. We do not request your conversation history, and we instruct assistants not to include contact details, secrets or other personal information. We filter recognized secrets, but a report can contain what the assistant wrote, so please tell your assistant if you do not want it to report a problem.
>
> We use reports to find and fix problems and decide what to improve. Reports are private. We may publish aggregated findings that do not identify you. [Reports are processed on our behalf by [feedback provider] and [AI model provider].]
>
> We keep reports for up to [90] days after the related issue is closed, and may keep anonymized summaries after that. To ask about or delete a report, contact [address]. Include enough detail for us to find it, because reports may not be linked to your account.

Also add the feedback provider (and any AI model provider) to your list of service providers, and the report retention period to your retention section.

## One-prompt setup

Paste this into your coding agent (Claude Code, Cursor, Codex, ...) from the root of your MCP server repository:

```text
Add the Most Loved Product feedback tool to this MCP server using @mostlovedproduct/mcp. Work in small steps and show me the diff before finishing.

1. Find where the MCP server and its tools are defined. Tell me which of these it is: (a) the official @modelcontextprotocol/sdk McpServer, (b) a hand-written JSON-RPC handler (for example on Cloudflare Workers), (c) something else. Also find the product name users know it by.
2. Install the package: npm i @mostlovedproduct/mcp (use this repo's package manager). If it uses the official SDK, zod 4 must be present; it normally already is.
3. Wire the tool:
   - (a): call registerFeedbackTool(server, { key, product, profile }) from "@mostlovedproduct/mcp/sdk".
   - (b): create a handler with createFeedbackHandler({ key, product, profile }) from "@mostlovedproduct/mcp", append handler.tool to the tools/list result, and route tools/call for handler.tool.name to handler.call(args, callInfo) returning its result unchanged.
   Use key = the secret MLP_SERVER_KEY (read it from the existing secrets/env mechanism; do not hard-code it, do not print it, and add it to .env.example or the equivalent with an empty value). Use profile "proactive" unless this server is listed in a consumer directory (ChatGPT apps, Claude connectors), in which case use "conservative".
4. Add server context in context(callInfo): trust ("authenticated" if the request is signed in, "known_host" if the caller is a recognised host, otherwise "anonymous"), client name if known, and app.version. Do not include emails, names or free text. Never take any of this from tool arguments.
5. Add a kill switch via enabled(): read a config flag such as FEEDBACK_KILL_SWITCH. If this server has rate limiting, give the feedback tool its own bucket.
6. Optionally append feedbackInstructions({ product, profile }) to the server's instructions if it has any.
7. Add one test that lists tools and checks submit_feedback is present, and one that calls it with a mocked fetch.
8. Do not edit the wording of the tool description or fields. Do not add a transcript or conversation field.
9. Tell me what to do next: create the sk key in the dashboard, set MLP_SERVER_KEY, update the privacy notice, and verify with an MCP inspector.
```

## API summary

Root entry: `feedbackTool(opts)`, `createFeedbackHandler(opts)`, `feedbackInstructions(opts)`, `validateArgs(args)`, constants `DESCRIPTIONS`, `FIELD_DESCRIPTIONS`, `RESULT_TEXTS`, `INSTRUCTIONS_TEMPLATE`, `TITLE_TEMPLATE`, `WORDING_VERSION`, `MCP_VERSION`, and the types.

`/sdk`: `registerFeedbackTool(server, opts)`, `feedbackZodSchema(product)`.

Handler options: `key`, `product`, `profile`, `name`, `extraGuidance`, `endpoint`, `fallbackEndpoint`, `timeoutMs`, `fetch`, `enabled`, `context`, `onResult`.
