import { checkCompetitor, staleCompetitors } from "./check.server";
import { refreshTraffic } from "../traffic/refresh.server";
import { refreshGap } from "../traffic/gap.server";

// Every hour, re-checks the competitors nobody has checked in a day, one at
// a time, and their search traffic and keyword gap when they're a week old.

const HOUR = 3600_000;
let started = false;
let running = false;

export async function checkStale() {
  if (running) return;
  running = true;
  try {
    for (const c of await staleCompetitors()) {
      await checkCompetitor(c.id).catch((err) => console.error(`Couldn't check competitor ${c.id}`, err));
      await refreshTraffic(c.id).catch((err) => console.error(`Couldn't refresh traffic for ${c.id}`, err));
      await refreshGap(c.id).catch((err) => console.error(`Couldn't refresh the keyword gap for ${c.id}`, err));
    }
  } finally {
    running = false;
  }
}

export function startTrackerSchedule() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  setInterval(() => void checkStale().catch((err) => console.error("Tracker run failed", err)), HOUR).unref();
  setTimeout(() => void checkStale().catch((err) => console.error("Tracker run failed", err)), 60_000).unref();
}
