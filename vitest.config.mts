import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Keep the drive letter uppercase on Windows; see scripts/vitest.mjs.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(
  /^[a-z]:/,
  (drive) => drive.toUpperCase(),
);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": root,
      "server-only": `${root}test/server-only.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
});
