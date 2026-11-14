import { describe, expect, it } from "vitest";
import { bestTimes, postingHeatmap, type SentPost } from "./best-times";

const TZ = "Europe/London";
const NOW = new Date("2026-11-14T08:00:00Z");

// A post on a November day (London is on UTC then) at an hour, doing well or not.
const post = (day: number, hour: number, likes: number, reach = 100, network: SentPost["network"] = "instagram"): SentPost => ({
  network,
  at: `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:05:00Z`,
  stats: { likes, comments: 0, reach },
});

describe("best times to post", () => {
  it("suggests typical times until there are enough posts with figures", () => {
    const best = bestTimes({ sent: [post(1, 10, 50)], networks: ["instagram"], day: "2026-11-16", tz: TZ, now: NOW });
    expect(best.fromPosts).toBe(0);
    expect(best.times.map((t) => t.time)).toEqual(["11:15", "13:15", "19:15"]);
    expect(best.times.map((t) => t.stars)).toEqual([4, 3, 5]);
  });

  it("ranks the hours the shop's own posts did best at", () => {
    const sent = [
      ...[1, 2, 3, 4].map((d) => post(d, 10, 30)),
      ...[1, 2, 3, 4].map((d) => post(d, 15, 5)),
      ...[5, 6, 7, 8].map((d) => post(d, 20, 15)),
      ...[5, 6].map((d) => post(d, 8, 10)),
    ];
    const best = bestTimes({ sent, networks: ["instagram"], day: "2026-11-16", tz: TZ, now: NOW });
    expect(best.fromPosts).toBe(14);
    expect(best.times).toEqual([
      { time: "08:15", stars: expect.any(Number) },
      { time: "10:15", stars: 5 },
      { time: "20:15", stars: expect.any(Number) },
    ]);
    // The weakest hour (3pm) isn't suggested.
    expect(best.times.some((t) => t.time.startsWith("15"))).toBe(false);
  });

  it("measures each network against itself, so a busy one doesn't drown out a quiet one", () => {
    // Facebook gets far more likes, but its 9am posts are only average for it.
    const sent = [
      ...[1, 2, 3, 4, 5].map((d) => post(d, 9, 100, 1000, "facebook")),
      ...[1, 2, 3, 4, 5].map((d) => post(d, 13, 100, 1000, "facebook")),
      ...[1, 2, 3, 4, 5].map((d) => post(d, 18, 40, 100)),
      ...[1, 2, 3, 4, 5].map((d) => post(d, 11, 5, 100)),
    ];
    const best = bestTimes({ sent, networks: ["facebook", "instagram"], day: "2026-11-16", tz: TZ, now: NOW });
    expect(best.times.find((t) => t.stars === 5)?.time).toBe("18:15");
  });

  it("only suggests times still to come today, and keeps clear of posts already booked", () => {
    const later = bestTimes({ sent: [], networks: ["instagram"], day: "2026-11-14", tz: TZ, now: new Date("2026-11-14T16:30:00Z") });
    expect(later.times.map((t) => t.time)).toEqual(["17:15", "19:15"]);
    const booked = bestTimes({ sent: [], networks: ["instagram"], day: "2026-11-16", tz: TZ, now: NOW, taken: ["19:10"] });
    expect(booked.times.map((t) => t.time)).toContain("19:45");
    const past = bestTimes({ sent: [], networks: ["instagram"], day: "2026-11-13", tz: TZ, now: NOW });
    expect(past.times).toEqual([]);
  });

  it("averages reach by weekday and hour for the report", () => {
    // 2 Nov 2026 is a Monday; London is on UTC then.
    const map = postingHeatmap([post(2, 10, 5, 100), post(9, 10, 5, 300), post(4, 19, 5, 50), { ...post(5, 9, 1), stats: null }], TZ);
    expect(map.measure).toBe("reach");
    expect(map.cells).toEqual(
      expect.arrayContaining([
        { weekday: 0, hour: 10, posts: 2, average: 200 },
        { weekday: 2, hour: 19, posts: 1, average: 50 },
      ]),
    );
    expect(map.cells).toHaveLength(2);
    expect([map.from, map.to]).toEqual([6, 22]);
    const noReach = postingHeatmap([{ network: "tiktok", at: "2026-11-02T23:30:00Z", stats: { likes: 4, comments: 1 } }], TZ);
    expect(noReach).toMatchObject({ measure: "engagements", cells: [{ weekday: 0, hour: 23, average: 5 }], to: 23 });
  });
});
