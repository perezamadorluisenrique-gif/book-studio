// Obsidian's community-plugin rules apply to everything that ships in the
// plugin (src/engine, src/app, src/preview, src/obsidian). The web host, tests
// and build tools run outside Obsidian, so its DOM and app rules are off there.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

export default defineConfig([
  { ignores: ["node_modules/", "dist/", "main.js", "out/", "fonts/", "sample/", ".github/", "version-bump.mjs", "src/web/activate/"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "esbuild.config.mjs", "tools/*.mjs"],
        },
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: [...DEFAULT_BRANDS, "Book Studio", "Book Studio Pro"],
          acronyms: [...DEFAULT_ACRONYMS, "EPUB", "KDP", "WCAG"],
        },
      ],
      // getSettingDefinitions() arrived in Obsidian 1.13; minAppVersion is 1.7.2, so the tab keeps display().
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  {
    files: ["*.mjs", "tools/**", "tests/**", "issuer/**"],
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly" } },
  },
  {
    // Build-time constants replaced by esbuild's define (see src/types.d.ts).
    files: ["src/config.ts"],
    rules: { "no-undef": "off" },
  },
  {
    files: ["src/web/**", "tests/**", "tools/**", "issuer/**", "*.mjs"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-active-doc": "off",
      "obsidianmd/prefer-instanceof": "off",
      "obsidianmd/prefer-window-timers": "off",
      "obsidianmd/no-static-styles-assignment": "off",
      "obsidianmd/no-forbidden-elements": "off",
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/no-global-this": "off",
      "obsidianmd/ui/sentence-case": "off",
      // The web app is not an Obsidian plugin: it has no requestUrl or vault storage.
      "no-restricted-globals": "off",
    },
  },
  {
    // A command-line tool reports on the console.
    files: ["tools/**"],
    rules: { "obsidianmd/rule-custom-message": "off" },
  },
]);
