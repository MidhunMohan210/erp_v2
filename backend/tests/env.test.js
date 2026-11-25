import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("backend environment configuration", () => {
  it("falls back to NODE_ENV for existing deployments", async () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await import("../config.js/env.js")).APP_ENV).toBe("production");

    vi.resetModules();
    vi.stubEnv("NODE_ENV", "staging");
    expect((await import("../config.js/env.js")).APP_ENV).toBe("staging");

    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    expect((await import("../config.js/env.js")).APP_ENV).toBe("development");
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("allows staging while preserving NODE_ENV", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("NODE_ENV", "production");
    expect((await import("../config.js/env.js")).APP_ENV).toBe("staging");
    expect(process.env.NODE_ENV).toBe("production");
  });

  it("uses the configured Tally URL or the existing default", async () => {
    vi.stubEnv("TALLY_BASE_URL", "");
    expect((await import("../config.js/env.js")).TALLY_BASE_URL).toBe("https://erpv2.camet.in/api/tally/");

    vi.resetModules();
    vi.stubEnv("TALLY_BASE_URL", "https://staging.example/api/tally/");
    expect((await import("../config.js/env.js")).TALLY_BASE_URL).toBe("https://staging.example/api/tally/");
  });

  it("rejects an unknown APP_ENV", async () => {
    vi.stubEnv("APP_ENV", "test");
    await expect(import("../config.js/env.js")).rejects.toThrow("APP_ENV must be development, staging, or production");
  });
});
