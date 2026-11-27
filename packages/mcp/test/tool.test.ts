import { describe, expect, it } from "vitest";
import { feedbackInstructions, feedbackTool } from "../src/index.js";

describe("feedbackTool", () => {
  const t = feedbackTool({ product: "Acme" });

  it("has the spec name, title and annotations", () => {
    expect(t.name).toBe("submit_feedback");
    expect(t.title).toBe("Send feedback to the Acme team");
    expect(t.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  });

  it("has the spec schema, plain JSON Schema", () => {
    const s = t.inputSchema;
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["kind", "summary", "goal", "impact"]);
    expect(Object.keys(s.properties)).toEqual([
      "kind", "summary", "goal", "impact", "tool", "actual", "expected", "suggestion", "requested_by_user",
    ]);
    expect(s.properties.kind.enum).toEqual(["broken", "confusing", "missing", "idea"]);
    expect(s.properties.impact.enum).toEqual(["blocked", "worked_around", "friction"]);
    expect(s.properties.summary).toMatchObject({ type: "string", minLength: 10, maxLength: 300 });
    expect(s.properties.goal).toMatchObject({ type: "string", minLength: 10, maxLength: 500 });
    expect(s.properties.tool).toMatchObject({ type: "string", maxLength: 200 });
    expect(s.properties.actual).toMatchObject({ maxLength: 1000 });
    expect(s.properties.expected).toMatchObject({ maxLength: 1000 });
    expect(s.properties.suggestion).toMatchObject({ maxLength: 500 });
    expect(s.properties.requested_by_user).toMatchObject({ type: "boolean" });
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/oneOf|anyOf|allOf|\$ref/);
  });

  it("has no field a model could use to set trust, identity or context", () => {
    const names = Object.keys(t.inputSchema.properties);
    for (const bad of ["trust", "user", "client", "source", "context", "flags", "app", "contact", "details", "transcript"]) {
      expect(names).not.toContain(bad);
    }
  });

  it("returns a fresh object each call", () => {
    const a = feedbackTool({ product: "Acme" });
    a.inputSchema.required.push("x");
    expect(feedbackTool({ product: "Acme" }).inputSchema.required).toHaveLength(4);
  });

  describe("name override", () => {
    it("accepts valid names and uses them in instructions", () => {
      expect(feedbackTool({ product: "Acme", name: "submit_acme_feedback" }).name).toBe("submit_acme_feedback");
      expect(feedbackInstructions({ product: "Acme", name: "submit_acme_feedback" })).toContain("with submit_acme_feedback after");
    });
    it.each(["Submit", "1abc", "ab", "has-dash", "has space", "", "a".repeat(65)])("rejects %j", (name) => {
      expect(() => feedbackTool({ product: "Acme", name })).toThrow(/name must match/);
    });
    it("accepts the length bounds", () => {
      expect(() => feedbackTool({ product: "Acme", name: "abc" })).not.toThrow();
      expect(() => feedbackTool({ product: "Acme", name: "a".repeat(64) })).not.toThrow();
    });
  });

  describe("extraGuidance", () => {
    it("is appended as one final paragraph, both profiles", () => {
      for (const profile of ["proactive", "conservative"] as const) {
        const base = feedbackTool({ product: "Acme", profile }).description;
        const d = feedbackTool({ product: "Acme", profile, extraGuidance: "Orders are never deleted." }).description;
        expect(d).toBe(`${base}\n\nOrders are never deleted.`);
      }
    });
    it("accepts exactly 300 characters, rejects 301", () => {
      expect(() => feedbackTool({ product: "Acme", extraGuidance: "x".repeat(300) })).not.toThrow();
      expect(() => feedbackTool({ product: "Acme", extraGuidance: "x".repeat(301) })).toThrow(/300/);
    });
    it("empty guidance adds nothing", () => {
      expect(feedbackTool({ product: "Acme", extraGuidance: "  " }).description).toBe(feedbackTool({ product: "Acme" }).description);
    });
  });

  it("requires a product, and a sane one", () => {
    expect(() => feedbackTool({ product: "" })).toThrow();
    expect(() => feedbackTool({ product: "A\nB" })).toThrow();
    expect(() => feedbackTool({ product: "Acme", profile: "loud" as never })).toThrow();
  });

  it("instructions: proactive line, empty for conservative", () => {
    expect(feedbackInstructions({ product: "Acme" })).toBe(
      "If a Acme tool fails, misleads you or lacks something the task needs, you can tell the Acme team with submit_feedback after finishing the affected step.",
    );
    expect(feedbackInstructions({ product: "Acme", profile: "conservative" })).toBe("");
  });
});
