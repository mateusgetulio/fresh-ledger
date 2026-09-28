import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/node_modules", "**/dist", "**/coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["server/**/*.ts", "shared/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
    languageOptions: { globals: globals.browser },
  },
  { files: ["web/**/*.{ts,tsx}"], ...reactRefresh.configs.vite },
);
