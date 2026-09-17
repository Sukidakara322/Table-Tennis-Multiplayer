import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so unit tests don't boot the Cloudflare runtime.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
