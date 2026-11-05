import comments from "@eslint-community/eslint-plugin-eslint-comments";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "packages/*/test/fixtures/**",
      // pnpm run corpus clones other repositories here.
      ".corpus/**",
      // Broken on purpose: the example shows what guards/no-default-on-union-switch reports.
      "examples/basic/src/status.ts",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          allowDefaultProject: ["vitest.config.ts", "vitest.setup.ts", "stateward.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "@eslint-community/eslint-comments": comments },
    rules: {
      "@eslint-community/eslint-comments/no-use": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": true },
      ],
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: false },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
