// Starts Vitest from a working directory whose Windows drive letter is
// uppercase. When a terminal is opened at "d:\…", Vitest loads its runner
// twice (once per spelling of the path) and every suite fails with
// "Cannot read properties of undefined (reading 'config')".
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
if (/^[a-z]:/.test(cwd)) {
  process.chdir(cwd[0].toUpperCase() + cwd.slice(1));
}

// Resolve from the normalised directory so the CLI and the test workers load
// Vitest through the same path spelling.
const require = createRequire(join(process.cwd(), "package.json"));
const cli = join(require.resolve("vitest/package.json"), "..", "vitest.mjs");
await import(pathToFileURL(cli).href);
