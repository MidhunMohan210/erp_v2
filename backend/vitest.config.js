import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup/db.js"],
    // Each worker starts an in-memory Mongo replica set. Two workers retain
    // practical feedback times without overloading local test environments.
    testTimeout: 15_000,
    maxWorkers: 2,
    // MongoMemory replica-set startup and HTTP fixture setup can transiently
    // reset under local resource pressure. Retrying runs the test after the
    // global cleanup hook has restored an empty database.
    retry: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
