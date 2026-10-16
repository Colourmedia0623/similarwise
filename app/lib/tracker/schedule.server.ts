import { checkCompetitor, staleCompetitors } from "./check.server";

// Every hour, re-checks the competitors nobody has checked in a day, one at a time.

const HOUR = 3600_000;
let started = false;
let running = false;

export async function checkStale() {
  if (running) return;
  running = true;
  try {
    for (const c of await staleCompetitors()) {
      await checkCompetitor(c.id).catch((err) => console.error(`Couldn't check competitor ${c.id}`, err));
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
