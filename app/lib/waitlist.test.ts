import { beforeEach, describe, expect, it } from "vitest";
import db from "../db.server";
import { parseSignup } from "./waitlist";
import { saveSignup, waitlist } from "./waitlist.server";

const form = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};

describe("waitlist", () => {
  beforeEach(async () => {
    await db.waitlistEntry.deleteMany();
  });

  it("tidies the email, rejects a bad one, and keeps one row per email", async () => {
    expect(parseSignup(form([["email", "nope"]]))).toEqual({ ok: false, error: "Please enter a valid email address." });
    const first = parseSignup(form([["email", " Jo@Shop.co.uk "]]));
    expect(first).toEqual({ ok: true, signup: { email: "jo@shop.co.uk", store: null } });
    if (!first.ok) return;
    await saveSignup(first.signup);
    await saveSignup({ email: "jo@shop.co.uk", store: "shop.co.uk" });
    await saveSignup({ email: "jo@shop.co.uk", store: null });
    expect((await waitlist()).map((e) => [e.email, e.store])).toEqual([["jo@shop.co.uk", "shop.co.uk"]]);
  });
});
