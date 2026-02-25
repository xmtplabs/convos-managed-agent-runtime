import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  // Serialize tests to prevent race conditions on shared mock server state
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: [
    {
      command: "npx tsx tests/mock-pool.ts",
      port: 3002,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env, MOCK_POOL_PORT: "3002" },
    },
    {
      command: "pnpm dev",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      // Spread process.env to keep PATH, HOME, etc.
      // POOL overrides land in process.env before Next.js boots,
      // taking precedence over any .env.local values.
      env: {
        ...process.env,
        POOL_API_URL: "http://localhost:3002",
        NEXT_PUBLIC_POOL_API_URL: "http://localhost:3002",
        POOL_API_KEY: "mock-key",
      },
    },
  ],
  // Use platform-independent snapshot paths so baselines work across macOS/Linux CI.
  // The {projectName} suffix differentiates desktop vs mobile.
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}",
  expect: {
    toHaveScreenshot: {
      // Allow 0.5% pixel difference for anti-aliasing/cross-platform variance
      maxDiffPixelRatio: 0.005,
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
});
