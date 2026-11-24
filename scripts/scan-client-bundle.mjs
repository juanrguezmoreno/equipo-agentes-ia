// Scans client JavaScript for secrets without reading any env file and
// without printing values: only the pattern name, the file and a count.
//
//   node scripts/scan-client-bundle.mjs              # local .next/static
//   node scripts/scan-client-bundle.mjs https://…    # a deployed site
//
// For a URL it downloads the HTML of "/" and every same-origin script it
// references. JWTs are decoded to report their `role` claim only, so the
// public anon key (role "anon") is told apart from a service-role key.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PATTERNS = {
  "Supabase secret key (sb_secret_)": /sb_secret_[0-9A-Za-z_-]{10,}/g,
  "Google API key (AIza)": /AIza[0-9A-Za-z_-]{30,}/g,
  "Groq API key (gsk_)": /gsk_[0-9A-Za-z]{20,}/g,
  "OpenAI/Anthropic style key (sk-)": /\bsk-(?:proj-|ant-)?[0-9A-Za-z_-]{20,}/g,
  "Private key block": /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
};
const JWT = /eyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/g;
// Server-only variable *names* that must never reach the client.
const SERVER_ONLY_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
];

async function localSources() {
  const root = join(process.cwd(), ".next", "static");
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".js")) out.push({ name: path.slice(root.length + 1), text: await readFile(path, "utf8") });
    }
  }
  await walk(root);
  return out;
}

async function remoteSources(base) {
  const html = await (await fetch(base)).text();
  const urls = new Set(
    [...html.matchAll(/(?:src|href)="([^"]+\.js[^"]*)"/g)].map((m) => new URL(m[1], base).href),
  );
  const out = [{ name: "/ (HTML)", text: html }];
  for (const url of urls) {
    if (new URL(url).origin !== new URL(base).origin) continue;
    out.push({ name: new URL(url).pathname, text: await (await fetch(url)).text() });
  }
  return out;
}

const target = process.argv[2];
const sources = target ? await remoteSources(target) : await localSources();
let problems = 0;
const roles = new Map();

for (const { name, text } of sources) {
  for (const [label, pattern] of Object.entries(PATTERNS)) {
    const count = text.match(pattern)?.length ?? 0;
    if (count) {
      problems += count;
      console.log(`SECRET  ${label}: ${count} in ${name}`);
    }
  }
  for (const token of text.match(JWT) ?? []) {
    let role = "unknown";
    try {
      role = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).role ?? "none";
    } catch {}
    roles.set(role, (roles.get(role) ?? 0) + 1);
    if (role === "service_role") {
      problems += 1;
      console.log(`SECRET  JWT with role service_role in ${name}`);
    }
  }
  for (const envName of SERVER_ONLY_NAMES) {
    if (text.includes(envName)) console.log(`NOTE    variable name ${envName} appears in ${name}`);
  }
}

const publicKeys = sources.reduce(
  (n, { text }) => n + (text.match(/sb_publishable_[0-9A-Za-z_-]{10,}/g)?.length ?? 0),
  0,
);
console.log(`Scanned ${sources.length} files from ${target ?? ".next/static"}.`);
console.log(`Public Supabase keys (sb_publishable_): ${publicKeys > 0 ? "present (expected)" : "none"}.`);
console.log(`JWT roles found: ${roles.size ? [...roles].map(([r, n]) => `${r}×${n}`).join(", ") : "none"}.`);
console.log(problems ? `FAIL: ${problems} secret occurrence(s).` : "OK: no server secrets in client code.");
process.exitCode = problems ? 1 : 0;
