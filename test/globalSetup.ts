import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// A fresh, migrated SQLite database for the tests (prisma/test.sqlite).
function clean() {
  rmSync("prisma/test.sqlite", { force: true });
  rmSync("prisma/test.sqlite-journal", { force: true });
}

export default function setup() {
  clean();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "file:./test.sqlite" },
    stdio: "ignore",
  });
  return clean;
}
