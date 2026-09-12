import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    // `deploy/**` carries each deployment profile's own tests: the profile asserts its own
    // constants, so the machine-specific strings live with the machine rather than in the core.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'deploy/**/*.test.ts'],
    exclude: ['tests/e2e/**']
  }
});
