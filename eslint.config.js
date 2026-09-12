import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte']
      }
    }
  },
  {
    // `.svelte.ts` modules carry runes (`$state`, `$derived`) outside a component and need the
    // Svelte parser to be read at all.
    files: ['**/*.svelte.ts'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser }
    }
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    // Ongoing serves from the root with no `base` path, and every URL the inventory shell builds is
    // computed — a query string produced by `formatQuery`/`formatSort` (the URL *is* the CLI
    // command, ADR 0006) or an entry href built from a kind and a slug. The rule is syntactic: it
    // only sees a literal `resolve()` call in the attribute, so it cannot be satisfied by a helper
    // that returns a path. Disabling it deliberately rather than scattering unresolvable calls.
    rules: { 'svelte/no-navigation-without-resolve': 'off' }
  },
  {
    ignores: ['.svelte-kit/', 'build/', 'coverage/', 'playwright-report/', 'test-results/']
  }
);
