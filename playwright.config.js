import { defineConfig, devices } from '@playwright/test';

// One runner, two layers:
//   unit — plain Node tests, no browser launched (never use the `page` fixture here)
//   e2e  — real-browser tests in Firefox
export default defineConfig({
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'unit',
      testDir: './tests/unit',
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  // Uncomment once the app has a dev server:
  // webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
});
