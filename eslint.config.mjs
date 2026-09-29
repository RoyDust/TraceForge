import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import { fixupConfigRules } from "@eslint/compat";
import { parser } from "typescript-eslint";

export default defineConfig([
  ...fixupConfigRules(nextVitals),
  // Next's bundled Babel scope manager still uses the ESLint 9 API.
  { files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "gateway/**",
    "prisma/generated/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
