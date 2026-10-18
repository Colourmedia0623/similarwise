import { describe, expect, it } from "vitest";
import { PLAN_KEYS, covers, pageTier, parsePlanKey, planKey } from "./billing";

describe("billing plans", () => {
  it("names each plan and cycle, and reads the name back", () => {
    expect(PLAN_KEYS).toHaveLength(6);
    expect(planKey("grow", "yearly")).toBe("Grow (yearly)");
    expect(parsePlanKey("Advertise (monthly)")).toEqual({ tier: "advertise", cycle: "monthly" });
    expect(parsePlanKey("Something else")).toBeNull();
  });

  it("knows which plan each page needs", () => {
    expect(pageTier("/app")).toBe("watch");
    expect(pageTier("/app/competitors/abc")).toBe("watch");
    expect(pageTier("/app/articles/abc")).toBe("grow");
    expect(pageTier("/app/ads")).toBe("advertise");
    expect(pageTier("/app/ad-ideas")).toBe("advertise");
    expect(pageTier("/app/adsx")).toBe("watch");
  });

  it("lets higher plans open lower plans' pages", () => {
    expect(covers("advertise", "grow")).toBe(true);
    expect(covers("grow", "grow")).toBe(true);
    expect(covers("watch", "grow")).toBe(false);
  });
});
