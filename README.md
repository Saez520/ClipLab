# ClipLab pipeline orchestrator

Deterministic MVP for the linear pipeline `NOTE → SCRIPT → STORYBOARD → RENDER → FINAL`.

## Run

```sh
npm install
npm run build
npm test -- --run
npm start
```

Runtime configuration is read directly from the process environment; the current scripts do not load `.env` automatically. The entrypoint consumes `PORT` and `DATABASE_PATH`, with defaults that allow a local start on port `3000` using `./data/pipeline.sqlite`. To override them, export variables first or pass them inline, for example `PORT=3100 DATABASE_PATH=./data/dev.sqlite npm start`. `.env.example` is reference-only, and its `LOG_LEVEL` entry is not currently consumed by the application.

The API is under `/api/v1`; `GET /health` is the health check. Create an opportunity with `POST /opportunities`, then use `POST /opportunities/:id/authorize`, `/advance`, `/block`, `/return`, or `/rollback`, and `GET /opportunities/:id/lineage`. Every advance requires the outgoing role's explicit authorization. Required handoff payloads are validated at the boundary and operations are audited in SQLite.

Roles are `DIRECTOR`, `WRITER`, `STORYBOARD`, and `EDITOR`. Forward advancement remains linear and cannot skip stages; `POST /opportunities/:id/rollback` permits a controlled jump only to an earlier stage. The API does not execute the content agents itself and has no authentication.

Production retries are explicit: an operator can retry a failed, non-specification render with `POST /renders/:renderId/retry`; there are no automatic retries. At startup, the render service marks orphaned `RUNNING` work as interrupted and automatically drains persisted `QUEUED` backlog.

## Current narrative and render contracts

- Narrative generation has one body contract, `generationInputSchema`, in `src/application/narrative-service.ts`. `actor` is optional and defaults to `narrator`; the API route delegates the raw body to the service instead of maintaining a second body schema.
- `tests/manual/cliplab-editor-qa.md` contains the producible manual fixtures and documents the narration anti-gap constraint (minimum 100 WPM, cap 180 WPM, maximum 1 second of silence).
- Composition templates use an injectable `templatesRoot` through `RenderService`/`buildApp`, with catalog resolution also supporting `CLIPLAB_TEMPLATES_ROOT`. The agnostic standard layout uses a full-frame clip shell plus a centered `content-stack`; the bundled `pulso` template is version **1.1.0** with `layout: "standard"`.

---

## Content agents — 5 materialized OpenCode agents

On top of the deterministic MVP API, the project ships **5 content agents** materialized as OpenCode prompts in `agents/` (registered in `opencode.json`):

| Role | Agent key | Prompt | Mode | Permissions |
|---|---|---|---|---|
| Director (editorial curation and validation) | `cliplab-director` | `agents/director.md` | primary | edit allow, bash allow |
| Síntesis (Director's context synthesis subagent) | `cliplab-sintesis` | `agents/sintesis.md` | subagent | edit deny, bash allow |
| Guionista (narrative writer) | `cliplab-guionista` | `agents/guionista.md` | subagent | edit deny, bash allow |
| Storyboard (dual-channel storyboard) | `cliplab-storyboard` | `agents/storyboard.md` | subagent | edit allow, bash allow |
| Editor (final synchronized MP4 via Hyperframes) | `cliplab-editor` | `agents/editor.md` | subagent | edit allow, bash allow |

Síntesis, Guionista, Storyboard and Editor are invoked only by the Director. The consolidated pipeline history (states, decisions and traceability) is documented in `docs/pipeline-agentes-contenido.md`; its implementation-status annotations explicitly stop at `main` @ `0544df4`, so use current `main` for later implementation state and Engram for decision traceability.

## Memory — conventions skill

The 5 content agents use a complementary memory layer via the skill `skill/convenciones-memoria-agentes-contenido/SKILL.md` (repo root): private namespaces (`content-agents/{rol}/*`), one owner per namespace, propose before saving, never modify the live agent definitions. Operational continuity remains the deterministic support (API).

## Docs

- `docs/pipeline-agentes-contenido.md` — consolidated content-agent pipeline history: flow, decisions, CA status table and traceability sources; implementation-status cutoff is `main` @ `0544df4`.
- `docs/estrategia-contenido-doble-canal.md` — dual-channel (audio/visual) content strategy, with status note.
- `docs/investigacion-hyperframes-roles-agentes.md` — Hyperframes and role research (raw reference material, with status note).

## Tests

`npm test -- --run` — vitest suite: **38 files / 218 tests** under `src/**/*.test.ts` and `tests/**/*.test.ts` on `main` @ `607c331` (pipeline, synthesis, curation, narrative, storyboard, render and production acceptance; composition catalog/layout; agent-config ×5; memory-conventions anti-drift).

## Knowledge graph

`graphify-out/` — repository knowledge graph generated with Graphify: **1041 nodes / 2105 links** (built at commit `607c3314`).
