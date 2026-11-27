import { describe, expect, it } from "vitest";
import { DESCRIPTIONS, FIELD_DESCRIPTIONS, WORDING_VERSION, feedbackInstructions, feedbackTool } from "../src/index.js";

// File snapshots: any wording change shows up as a diff of a plain text file.
describe("exact wording", () => {
  it("version", () => expect(WORDING_VERSION).toBe("2026-11-18"));

  it("proactive description", async () => {
    await expect(feedbackTool({ product: "Acme" }).description).toMatchFileSnapshot("./__snapshots__/proactive.description.txt");
  });
  it("conservative description", async () => {
    await expect(feedbackTool({ product: "Acme", profile: "conservative" }).description).toMatchFileSnapshot(
      "./__snapshots__/conservative.description.txt",
    );
  });
  it("field descriptions", async () => {
    const t = feedbackTool({ product: "Acme" });
    const lines = Object.entries(t.inputSchema.properties).map(([k, v]) => `${k}: ${v.description}`);
    await expect(lines.join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/fields.txt");
  });
  it("title, instructions", async () => {
    const out = [
      feedbackTool({ product: "Acme" }).title,
      feedbackInstructions({ product: "Acme" }),
      JSON.stringify(feedbackInstructions({ product: "Acme", profile: "conservative" })),
    ].join("\n");
    await expect(out + "\n").toMatchFileSnapshot("./__snapshots__/title-instructions.txt");
  });
  it("templates keep {Product} unsubstituted", () => {
    expect(DESCRIPTIONS.proactive).toContain("{Product}'s tools");
    expect(FIELD_DESCRIPTIONS.goal).toContain("{Product}'s tools");
    expect(feedbackTool({ product: "Acme" }).description).not.toContain("{Product}");
  });
  it("product name is substituted literally (no replacement patterns)", () => {
    expect(feedbackTool({ product: "A$&B" }).description).toContain("A$&B team");
  });
});
