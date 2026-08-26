# QA manual — `cliplab-storyboard`

Este protocolo valida los criterios del CA `ca-agente-storyboard`. Cada escenario es binario: se marca `[x]` únicamente si se cumple todo su resultado observable.

## Setup común

1. Desde la raíz del repositorio, ejecutar `npm run dev` y mantener el proceso activo.
2. Verificar soporte: `curl -fsS http://localhost:3000/health` debe responder `{"status":"ok"}`.
3. Abrir OpenCode en esta raíz y seleccionar el agente primario `cliplab-director`.
4. Usar IDs distintos por escenario para evitar estado compartido.

## Fixtures

### F1 — oportunidad con guion `DIRECTOR_VALIDATED` y handoff SCRIPT→STORYBOARD

Requiere `jq` únicamente para encadenar los IDs devueltos por la API e incrustar el handoff narrativo.

```bash
OPP=qa-story
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d "{\"opportunityId\":\"$OPP\"}"
PROPOSAL_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/curation/proposals" -H 'content-type: application/json' -d '{"originalNote":"Reduje de 40 a 8 minutos el diagnóstico de fallos de automatización en tres proyectos.","evidence":"Registros propios de tres proyectos: 40 min antes, 8 min después.","centralApproach":"Mostrar el método de diagnóstico y su reducción medible.","audience":"AUTOMATION_CLIENTS","objective":"DISCOVERY"}' | jq -r '.proposal_id')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/curation/proposals/$PROPOSAL_ID/approve" -H 'content-type: application/json' -d '{"actor":"developer"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/advance" -H 'content-type: application/json' -d "{\"actor\":\"director\",\"role\":\"DIRECTOR\",\"payload\":{\"opportunityId\":\"$OPP\",\"originalNote\":\"Reduje de 40 a 8 minutos el diagnóstico de fallos de automatización en tres proyectos.\",\"directorDecision\":\"APPROVE\",\"centralApproach\":\"Mostrar el método de diagnóstico y su reducción medible.\"}}"
CONFIG_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/configurations" -H 'content-type: application/json' -d '{"director":"director","configuration":{"audience":"clientes de automatización","tone":"directo","depth":"profundo","voice":"calma","style":"continuo","targetDurationSeconds":60}}' | jq -r '.configuration_id')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/configurations/$CONFIG_ID/approve" -H 'content-type: application/json' -d '{"actor":"developer"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/generate" \
  -H 'content-type: application/json' \
  -d '{"actor":"narrator","narrativeText":"span-s1 span-s2 span-s3 [source.md:1]","sources":{"source.md":"span-s1 span-s2 span-s3 audio-s1 audio-s2 audio-s3 visual-s1 visual-s2 visual-s3 meaning-s1 meaning-s2 meaning-s3 new visual revised visual change editorial wording"}}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/validate" -H 'content-type: application/json' -d '{"actor":"director","role":"DIRECTOR"}' > /dev/null
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/advance" -H 'content-type: application/json' \
  -d "$(jq -n --argjson p "$(curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/narrative/handoff)" '{actor:"writer", role:"WRITER", payload:$p}')"
```

### F2 — payload de segmento dual-channel (transcripción del fixture de `src/application/storyboard-service.test.ts`)

```bash
SEG1='{"segmentId":"s1","narrativeSpan":"span-s1","narrativeStart":0,"narrativeEnd":7,"durationSeconds":30,"audio":"audio-s1","visualRepresentation":"visual-s1","audiovisualMapping":{"narrativeMeaning":"meaning-s1","audio":"audio-s1","visual":"visual-s1","correspondence":"mapping-s1"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s1"}],"technicalCoverage":[]}'
SEG2='{"segmentId":"s2","narrativeSpan":"span-s2","narrativeStart":8,"narrativeEnd":15,"durationSeconds":30,"audio":"audio-s2","visualRepresentation":"visual-s2","audiovisualMapping":{"narrativeMeaning":"meaning-s2","audio":"audio-s2","visual":"visual-s2","correspondence":"mapping-s2"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s2"}],"technicalCoverage":[],"dependsOn":["s1"]}'
SEG3='{"segmentId":"s3","narrativeSpan":"span-s3","narrativeStart":16,"narrativeEnd":23,"durationSeconds":30,"audio":"audio-s3","visualRepresentation":"visual-s3","audiovisualMapping":{"narrativeMeaning":"meaning-s3","audio":"audio-s3","visual":"visual-s3","correspondence":"mapping-s3"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s3"}],"technicalCoverage":[]}'
```

---

## 1. Invisibilidad

**Criterio:** `cliplab-storyboard` no es visible ni seleccionable por el usuario; solo existe para el Director (D-01).

**Precondición:** setup común; ninguna adicional.

**Pasos:** (a) en el selector de agentes de OpenCode (mención `@` o selector de modo), buscar `cliplab-storyboard`; (b) verificar el registro en `opencode.json`.

**Resultado binario:** (a) `cliplab-storyboard` no aparece como seleccionable ni dentro de la mención `@`; el usuario solo conversa con `cliplab-director`; (b) el registro existe con `hidden: true` y `mode: "subagent"`.

**Comprobación:**

```bash
node -e "const c=JSON.parse(require('fs').readFileSync('opencode.json','utf8')); const s=c.agent['cliplab-storyboard']; console.assert(s && s.hidden===true && s.mode==='subagent', 'registro inválido')"
```

- [ ] PASS

## 2. Delegación exitosa con segmentos dual-channel

**Criterio:** una delegación del Director sobre guion `DIRECTOR_VALIDATED` produce un storyboard `STORYBOARD_READY_FOR_USER_APPROVAL` con segmentos ordenados, duración por suma, posiciones contiguas, mapping audio-visual, ritmo, sincronización y fuentes (D-02, D-03, D-05).

**Precondición:** ejecutar F1 y F2 (oportunidad `qa-story` con guion validado y handoff SCRIPT→STORYBOARD avanzado).

**Pasos:** invocar al Storyboard desde el Director con los punteros del encargo (`opportunityId`, `scriptId`, `directorValidationId`/`scriptAuthorization`, perfil, 3 configurables, fuentes persistidas) y crear el storyboard con los segmentos `s1`+`s2` de F2.

**Comprobación:**

```bash
OPP=qa-story
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG1,$SEG2]}" | tee /tmp/qa-story-create.json | jq -e '.state == "STORYBOARD_READY_FOR_USER_APPROVAL" and .finalDurationSeconds == 60 and (.segments | length) == 2 and .segments[0].position == 0 and .segments[1].position == 1 and .segments[0].audiovisualMapping.correspondence == "mapping-s1" and .segments[0].rhythm == "steady" and .segments[0].synchronization == "sync"'
```

**Resultado binario:** `create` responde 201; la revisión queda `STORYBOARD_READY_FOR_USER_APPROVAL` con `finalDurationSeconds == 60` (suma 30+30), posiciones `0,1`, mapping/ritmo/sincronización por segmento y fuentes resueltas.

- [ ] PASS

## 3. Trazabilidad de fuentes por segmento

**Criterio:** cada segmento materializa `sourceReferences` resueltas server-side contra el script persistido: `path`, `locator` canónico y `content`/`summary` (D-07).

**Precondición:** escenario 2 ejecutado (revisión creada en `qa-story`).

**Pasos:** leer la revisión vigente y verificar las fuentes resueltas de `s1`.

**Resultado binario:** la fuente resuelta de `s1` tiene `path: "source.md"`, `locator` canónico de líneas y `content`/`summary` no vacíos (resuelto contra `script.sources["source.md"]`, nunca copia del cliente).

**Comprobación:**

```bash
OPP=qa-story
curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/storyboard | jq -e '.segments[0].sourceReferences[0].path == "source.md" and (.segments[0].sourceReferences[0].content | length) > 0'
```

- [ ] PASS

## 4. Bloqueo por fuente irresoluble

**Criterio:** una referencia a fuente no persistida en el guion (`path` ausente en `script.sources`) bloquea el storyboard sin entregar parcial (D-06/D-07).

**Precondición:** ejecutar F1 con ID nuevo (`qa-src-rota`).

**Pasos:** crear un storyboard cuyo segmento referencia `other.md` (inexistente en `sources`) y verificar el error.

**Comprobación:**

```bash
OPP=qa-src-rota
# repetir F1 con OPP=qa-src-rota
SEG_ROTO='{"segmentId":"s1","narrativeSpan":"span-s1","narrativeStart":0,"narrativeEnd":7,"durationSeconds":30,"audio":"audio-s1","visualRepresentation":"visual-s1","audiovisualMapping":{"narrativeMeaning":"meaning-s1","audio":"audio-s1","visual":"visual-s1","correspondence":"mapping-s1"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"other.md","locator":"1","segmentId":"s1"}],"technicalCoverage":[]}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG_ROTO]}" 2>/dev/null | jq -e '.error.code == "SOURCE_UNRESOLVED"'
```

**Resultado binario:** el `create` responde 409 con `error.code == "SOURCE_UNRESOLVED"`; no se crea ninguna revisión (`GET /storyboard` responde 404) y el Storyboard devuelve al Director el bloqueo con la fuente nombrada, sin parcial ni invención.

- [ ] PASS

## 5. Bloqueo por contradicción material / afirmación no sostenida

**Criterio:** una representación visual no respaldada por las fuentes (contradice o introduce afirmación no sostenida) bloquea el segmento con motivo visible; no llega a `READY_FOR_USER_APPROVAL` (D-06, Pieza 3C).

**Precondición:** ejecutar F1 con ID nuevo (`qa-contradicc`).

**Pasos:** crear un storyboard cuyo segmento `s1` propone `visualRepresentation: "aerial drone shot over the city"` (no sostenido por el material).

**Comprobación:**

```bash
OPP=qa-contradicc
# repetir F1 con OPP=qa-contradicc
SEG_INVENT='{"segmentId":"s1","narrativeSpan":"span-s1","narrativeStart":0,"narrativeEnd":7,"durationSeconds":30,"audio":"audio-s1","visualRepresentation":"aerial drone shot over the city","audiovisualMapping":{"narrativeMeaning":"meaning-s1","audio":"audio-s1","visual":"aerial drone shot over the city","correspondence":"mapping-s1"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s1"}],"technicalCoverage":[]}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG_INVENT]}" 2>/dev/null | jq -e '.error.code == "STORYBOARD_BLOCKED"'
```

**Resultado binario:** el `create` responde 409 con `error.code == "STORYBOARD_BLOCKED"` y motivo visible (validación material fallida / afirmación no sostenida); el Storyboard no entrega parcial y no rellena con invención.

- [ ] PASS

## 6. Bloqueo audio-como-subtítulos

**Criterio:** `visualRepresentation === audio` (mismo texto) no es dual-channel: la representación es inválida y la pieza queda bloqueada (D-06, Bloque 1E).

**Precondición:** ejecutar F1 con ID nuevo (`qa-subtitles`).

**Pasos:** crear un storyboard cuyo segmento repite el audio como visual.

**Comprobación:**

```bash
OPP=qa-subtitles
# repetir F1 con OPP=qa-subtitles
SEG_SUB='{"segmentId":"s1","narrativeSpan":"span-s1","narrativeStart":0,"narrativeEnd":7,"durationSeconds":30,"audio":"audio-s1","visualRepresentation":"audio-s1","audiovisualMapping":{"narrativeMeaning":"meaning-s1","audio":"audio-s1","visual":"audio-s1","correspondence":"mapping-s1"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s1"}],"technicalCoverage":[]}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG_SUB]}" 2>/dev/null | jq -e '.error.code == "STORYBOARD_BLOCKED"'
```

**Resultado binario:** el `create` responde 409 con `error.code == "STORYBOARD_BLOCKED"` (audio repetido como subtítulos no es representación dual-channel); el storyboard no avanza.

- [ ] PASS

## 7. Corrección dirigida por segmento con dependencias

**Criterio:** corregir `s1` revalida `s1` y sus dependientes (`s2` via `dependsOn`), conserva intactos los no afectados (`s3`), y genera nueva revisión con `version + 1` (D-08, Pieza 2B/5C).

**Precondición:** ejecutar F1 y F2 con ID nuevo (`qa-corr`), crear storyboard con `s1`+`s2`+`s3`.

**Pasos:** solicitar corrección de `s1` con `expectedAdjustment: "new visual"`.

**Comprobación:**

```bash
OPP=qa-corr
# repetir F1 con OPP=qa-corr
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG1,$SEG2,$SEG3]}" > /dev/null
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard/corrections" -H 'content-type: application/json' \
  -d '{"actor":"user","segmentId":"s1","expectedAdjustment":"new visual"}' | jq -e '.affectedSegmentIds == ["s1","s2"] and .revision.segments[0].version == 2 and .revision.segments[1].version == 2 and .revision.segments[2].version == 1 and .revision.state == "STORYBOARD_CORRECTION_REQUESTED"'
```

**Resultado binario:** el `POST /corrections` responde 201; `affectedSegmentIds == ["s1","s2"]`, la nueva revisión está `STORYBOARD_CORRECTION_REQUESTED` con `segments[0].version == 2` y `segments[1].version == 2` pero `segments[2].version == 1` (intacto); el paquete no puede avanzar con la corrección `PENDING`.

- [ ] PASS

## 8. Bloqueo de handoff con corrección pendiente (PENDING)

**Criterio:** mientras exista una corrección `PENDING` sin revalidar, el handoff STORYBOARD→RENDER queda bloqueado (Pieza 2B/2C, D-08).

**Precondición:** escenario 7 ejecutado (`qa-corr` con corrección `PENDING` en `s1`).

**Pasos:** aprobar la revisión vieja e intentar obtener el handoff.

**Resultado binario:** la revisión anterior no puede aprobarse (no es la vigente) y el handoff responde error — la revisión vigente no está `STORYBOARD_USER_APPROVED`/tiene corrección pendiente; el paquete no avanza a producción hasta nueva aprobación explícita.

**Comprobación:**

```bash
OPP=qa-corr
curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/storyboard/handoff 2>/dev/null | jq -e '.error.code == "STORYBOARD_APPROVAL_REQUIRED" or .error.code == "STORYBOARD_BLOCKED"'
```

- [ ] PASS

## 9. Aprobación explícita habilitante: USER_APPROVED → AUTHORIZED_FOR_PRODUCTION

**Criterio:** con autorización STORYBOARD persistida y `POST /approve {actor, storyboardRevisionId}` de la revisión vigente, el handoff devuelve el paquete `AUTHORIZED_FOR_PRODUCTION` completo (D-09, Pieza 5D-E).

**Precondición:** ejecutar F1 y F2 con ID nuevo (`qa-aprob`), crear storyboard con `s1`+`s2`, registrar la autorización STORYBOARD y aprobar la revisión vigente.

**Pasos:** (a) autorizar STORYBOARD→STORYBOARD; (b) aprobar con `storyboardRevisionId` de la revisión vigente; (c) leer el handoff.

**Comprobación:**

```bash
OPP=qa-aprob
# repetir F1 con OPP=qa-aprob
REV=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG1,$SEG2]}" | jq -r '.storyboardRevisionId')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/authorize" -H 'content-type: application/json' -d '{"role":"STORYBOARD","actor":"storyboard"}' > /dev/null
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard/approve" -H 'content-type: application/json' \
  -d "{\"actor\":\"user\",\"storyboardRevisionId\":\"$REV\"}" | jq -e '.state == "STORYBOARD_USER_APPROVED"'
curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/storyboard/handoff | jq -e '.authorizationState == "AUTHORIZED_FOR_PRODUCTION" and .finalDurationSeconds == 60 and .userApprovalId != null'
```

**Resultado binario:** `approve` lleva la revisión a `STORYBOARD_USER_APPROVED` (solo la vigente, sin pendientes) y el handoff responde 200 con el paquete completo `AUTHORIZED_FOR_PRODUCTION` (duración final, segmentos ordenados, mapping, ritmo/posiciones, perfil, fuentes, validaciones, aprobación y autorización de producción).

- [ ] PASS

## 10. Bloqueo sin aprobación explícita >90s

**Criterio:** una pieza con `finalDurationSeconds > 90` (`requiresExplicitApproval`) no avanza a handoff sin aprobación explícita del usuario, incluso con autorización STORYBOARD persistida (D-05, Bloque 5D).

**Precondición:** ejecutar F1 y F2 con ID nuevo (`qa-90s`), crear storyboard con `s1` (30s) + un segmento de 61s, y autorizar STORYBOARD **sin** aprobar.

**Pasos:** intentar obtener el handoff sin aprobar; luego aprobar y reintentar.

**Comprobación:**

```bash
OPP=qa-90s
# repetir F1 con OPP=qa-90s
SEG61='{"segmentId":"s2","narrativeSpan":"span-s2","narrativeStart":8,"narrativeEnd":15,"durationSeconds":61,"audio":"audio-s2","visualRepresentation":"visual-s2","audiovisualMapping":{"narrativeMeaning":"meaning-s2","audio":"audio-s2","visual":"visual-s2","correspondence":"mapping-s2"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s2"}],"technicalCoverage":[]}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG1,$SEG61]}" | jq -e '.finalDurationSeconds == 91'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/authorize" -H 'content-type: application/json' -d '{"role":"STORYBOARD","actor":"storyboard"}' > /dev/null
curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/storyboard/handoff 2>/dev/null | jq -e '.error.code == "STORYBOARD_APPROVAL_REQUIRED"'
```

**Resultado binario:** el storyboard creado tiene `finalDurationSeconds == 91` (>90); el handoff sin aprobar responde 409 con `STORYBOARD_APPROVAL_REQUIRED`; solo tras `POST /approve` explícito el handoff responde 200.

- [ ] PASS

## 11. Aislamiento y fail-closed

**Criterio:** el Storyboard entrega solo al Director, y ante fallo de lectura/POST/GET muestra el fallo visible, devuelve `STORYBOARD_BLOCKED` con `blockedReason`/`blockedRecipient` nombrando el fallo, cero reintentos y nunca presenta como registrado lo no persistido (D-04, Pieza 7E).

**Precondición:** setup común; ninguna adicional.

**Pasos:** (a) verificar que `cliplab-storyboard` no entrega resultados al usuario ni a otros agentes (toda salida llega solo dentro de la conversación del Director); (b) con el servidor detenido, delegar un storyboard desde el Director y observar la respuesta del agente.

**Resultado binario:** (a) ninguna salida del Storyboard aparece fuera de la conversación del Director; (b) el agente declara el fallo visible (`storyboard:`), devuelve `STORYBOARD_BLOCKED` con `blockedReason` + `blockedRecipient` nombrando el fallo de fetch, realiza cero reintentos automáticos, no diagnostica entorno ni levanta servidores, y no presenta como registrado ningún resultado no persistido.

**Comprobación:** observacional (a) en OpenCode; (b) con `npm run dev` detenido, pedir al Director delegar el storyboard de `qa-story` y capturar la respuesta del agente.

- [ ] PASS

---

## Cierre

El CA pasa QA conversacional únicamente con las **11 casillas marcadas**. Una casilla fallida conserva el output de OpenCode y los responses de curl asociados; no se interpreta como éxito parcial.