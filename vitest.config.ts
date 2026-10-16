import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests don't boot the React Router plugin.
// Tests that touch the database get their own SQLite file, migrated fresh
// each run (test/globalSetup.ts).
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    env: { DATABASE_URL: "file:./test.sqlite" },
    fileParallelism: false,
  },
});
