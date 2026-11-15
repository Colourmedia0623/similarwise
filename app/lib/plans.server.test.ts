import { describe, expect, it } from "vitest";
import { defaultPlanConfig, mergePlanConfig } from "./plans.server";

describe("plan settings", () => {
  it("starts from today's plans", () => {
    const c = defaultPlanConfig();
    expect(c.limits.watch.competitors).toBe(5);
    expect(c.limits.advertise.rankKeywords).toBe(50);
    expect(c.pages["/app/ranks"]).toBe("grow");
    expect(c.pages["/app/inbox"]).toBe("advertise");
    expect(c.pages["/app/competitors"]).toBe("watch");
    expect(c.includes.grow[0]).toBe("Everything in Watch");
  });

  it("keeps what's stored and ignores what doesn't fit", () => {
    const c = mergePlanConfig({
      limits: { watch: { competitors: 3, rankKeywords: -1 }, grow: { competitors: "12" }, advertise: { aiPrompts: 1.5 } },
      pages: { "/app/ranks": "watch", "/app/ads": "platinum", "/app/nowhere": "watch" },
      includes: { watch: [" One ", "", "Two"] },
    });
    expect(c.limits.watch.competitors).toBe(3);
    expect(c.limits.watch.rankKeywords).toBe(50);
    expect(c.limits.grow.competitors).toBe(12);
    expect(c.limits.advertise.aiPrompts).toBe(15);
    expect(c.pages["/app/ranks"]).toBe("watch");
    expect(c.pages["/app/ads"]).toBe("advertise");
    expect(c.pages["/app/nowhere"]).toBeUndefined();
    expect(c.includes.watch).toEqual(["One", "Two"]);
    expect(c.includes.grow[0]).toBe("Everything in Watch");
  });

  it("survives nothing stored", () => {
    expect(mergePlanConfig(null)).toEqual(defaultPlanConfig());
  });
});
