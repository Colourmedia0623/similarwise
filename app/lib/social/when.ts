// Dates and times in the shop's own time zone, for the social calendar. Used
// on the server and in the page, so both show the same day and time.

export const validZone = (tz: string | null | undefined) => {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
};

// The day (YYYY-MM-DD) and time (HH:mm) a moment falls on in a time zone.
export function zoned(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// The moment a day and time on the shop's clock happens. Around a clock
// change the earlier reading wins.
export function fromZoned(day: string, time: string, tz: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const want = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const seen = zoned(new Date(guess), tz);
    const [y, m, dd] = seen.day.split("-").map(Number);
    const [h, mi] = seen.time.split(":").map(Number);
    const diff = want - Date.UTC(y, m - 1, dd, h, mi);
    if (!diff) break;
    guess += diff;
  }
  return new Date(guess);
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

// Monday of the week a day is in.
export const weekStart = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

export const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    ...opts,
  });

// 9:30 am, the way the calendar shows times.
export function timeLabel(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
