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
