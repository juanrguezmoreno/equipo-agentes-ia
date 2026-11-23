# Claude Code project conventions

## Project

Build a small, observable team of AI agents in Next.js App Router and TypeScript.
The Orchestrator plans work, Develop proposes versioned changes to a virtual
example project, and Testing validates those changes before a task is complete.
The architecture proposal is in `docs/ARQUITECTURA.md`; its decisions are
provisional until approved.

## Working agreements

- Work in the phase the user approved. Stop at each phase boundary and summarize
  the result for approval before continuing.
- Before implementing, inspect the existing code and current official
  documentation for the relevant libraries. Do not invent APIs.
- Prefer small, focused changes that follow established project patterns.
- Keep TypeScript strict and validate every agent's output with the relevant Zod
  schema. Treat model output as untrusted input.
- Keep each serverless invocation short, bounded, and safe to retry. Persist
  workflow state before returning; do not run the entire agent loop in one
  request.
- Keep agent actions and state transitions auditable through concise,
  timestamped events. Do not log secrets or unnecessarily duplicate generated
  source in event summaries.
- Require deterministic checks as well as a model review before marking work
  complete. Apply the per-task iteration cap.
- Keep credentials out of source control. Use `.env.local` for local secrets,
  commit only a documented `.env.example`, and configure deployment secrets in
  the hosting/database dashboards.
- Use Conventional Commits with small, descriptive commits when committing is
  requested or appropriate.
- Run the narrowest relevant tests, lint, and type checks; report what ran and
  any limitations.

## Security and cost

- Enforce ownership and least privilege with Supabase Auth and Row Level
  Security. Never expose a service-role key or model API key to the browser.
- Validate request size, generated paths, content size, and per-user request
  rates on the server.
- Keep model selection configurable via environment variables. Free-tier
  quotas, model availability, and hosting limits can change; disclose rather
  than promise unlimited free usage.

## Phase journal

Record user requests, decisions, and outcomes in `docs/BITACORA.md`. Update
architecture and process documentation as decisions are approved and
implemented; do not present proposed or unverified behavior as complete.
