# ClipLab pipeline orchestrator

Deterministic MVP for the linear pipeline `NOTE → SCRIPT → STORYBOARD → RENDER → FINAL`.

## Run

```sh
npm install
cp .env.example .env
npm run build
npm test -- --run
npm start
```

The API is under `/api/v1`; `GET /health` is the health check. Create an opportunity with `POST /opportunities`, then use `/authorize`, `/advance`, `/block`, `/return`, and `/lineage`. Every advance requires the outgoing role's explicit authorization. Required handoff payloads are validated at the boundary and every operation is audited in SQLite.

Roles are `DIRECTOR`, `WRITER`, `STORYBOARD`, and `EDITOR`. The MVP intentionally has no retries, automatic resumption, agent execution, authentication, external providers, or arbitrary jumps.

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

Síntesis, Guionista, Storyboard and Editor are invoked only by the Director. The content pipeline (states, decisions, traceability) is documented in `docs/pipeline-agentes-contenido.md` (current source of truth).

## Memory — conventions skill

The 5 content agents use a complementary memory layer via the skill `skill/convenciones-memoria-agentes-contenido/SKILL.md` (repo root): private namespaces (`content-agents/{rol}/*`), one owner per namespace, propose before saving, never modify the live agent definitions. Operational continuity remains the deterministic support (API).

## Docs

- `docs/pipeline-agentes-contenido.md` — content agent pipeline: flow, decisions, CA status table and traceability sources (current source of truth).
- `docs/estrategia-contenido-doble-canal.md` — dual-channel (audio/visual) content strategy, with status note.
- `docs/investigacion-hyperframes-roles-agentes.md` — Hyperframes and role research (raw reference material, with status note).

## Tests

`npm test` — vitest suite: **35 files / 163 tests** green on `main` @ `0544df4` (pipeline, synthesis, curation, narrative, storyboard, production acceptance; agent-config ×5; memory-conventions anti-drift).

## Knowledge graph

`graphify-out/` — repository knowledge graph generated with Graphify: **976 nodes / 1971 links** (built at commit `0544df4`).