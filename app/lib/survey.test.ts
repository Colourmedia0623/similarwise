import { beforeEach, describe, expect, it } from "vitest";
import db from "../db.server";
import { parseSurvey } from "./survey";
import { saveSurvey, surveyResults } from "./survey.server";

const form = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};

const good: [string, string][] = [
  ["email", " Jo@Shop.co.uk "],
  ["revenue", "1m_10m"],
  ["tracking", "visit_sites"],
  ["tracking", "made_up"],
  ["features", "ads"],
  ["features", "search"],
  ["price", "49"],
];

describe("parseSurvey", () => {
  it("keeps known answers and tidies the email", () => {
    const r = parseSurvey(form(good));
    expect(r).toEqual({
      ok: true,
      answers: {
        email: "jo@shop.co.uk",
        store: null,
        revenue: "1m_10m",
        tracking: ["visit_sites"],
        features: ["ads", "search"],
        price: "49",
        question: null,
      },
    });
  });

  it("rejects a bad email, missing answers and too many features", () => {
    expect(parseSurvey(form([["email", "nope"], ...good.slice(1)])).ok).toBe(false);
    expect(parseSurvey(form(good.filter(([k]) => k !== "price"))).ok).toBe(false);
    const four: [string, string][] = ["ads", "search", "spend", "alerts"].map((f) => ["features", f]);
    const r = parseSurvey(form([...good.filter(([k]) => k !== "features"), ...four]));
    expect(r).toEqual({ ok: false, error: "Please pick at most 3 features." });
  });
});

describe("surveyResults", () => {
  beforeEach(async () => {
    await db.waitlistEntry.deleteMany();
  });

  it("counts answers once per email and measures the pay target", async () => {
    const save = async (fields: [string, string][]) => {
      const r = parseSurvey(form(fields));
      if (!r.ok) throw new Error(r.error);
      await saveSurvey(r.answers);
    };
    await save(good);
    await save([...good.filter(([k]) => k !== "price"), ["price", "149"]]); // Same person answers again.
    await save([["email", "sam@store.com"], ["revenue", "under_250k"], ["features", "ads"], ["price", "19"]]);

    const r = await surveyResults();
    expect(r.total).toBe(2);
    expect(r.willPay49).toBe(1);
    expect(r.willPay49Share).toBe(0.5);
    expect(r.features[0]).toEqual({ label: "The ads they run on Meta, TikTok and Google", count: 2 });
    expect(r.price.find((p) => p.label === "$149 a month")?.count).toBe(1);
  });
});
