import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup/db.js"],
    // Full-suite parallelism starts several in-memory Mongo replica sets.
    // Five seconds is occasionally too short for otherwise valid test setup
    // and transaction work under that local resource contention.
    testTimeout: 15_000,
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
