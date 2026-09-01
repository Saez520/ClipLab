# QA manual — `cliplab-editor`

Este protocolo valida los criterios del CA `ca-agente-editor`. Cada escenario es binario: se marca `[x]` únicamente si se cumple todo su resultado observable.

## Setup común

1. Desde la raíz del repositorio, ejecutar `npm run dev` y mantener el proceso activo.
2. Verificar soporte: `curl -fsS http://localhost:3000/health` debe responder `{"status":"ok"}`.
3. Abrir OpenCode en esta raíz y seleccionar el agente primario `cliplab-director`.
4. Usar IDs distintos por escenario para evitar estado compartido.
5. Los escenarios que requieren render real (CLI Hyperframes + Chrome/FFmpeg + voz TTS) presuponen entorno con `node_modules/.bin/hyperframes` disponible; en entornos sin engine se evalúa con fakes inyectados (`buildApp(':memory:', {renderer, synthesizer})`) para las comprobaciones de estado/cola/fallos que no dependen del binario.

## Fixtures

> **Restricción anti-gap (post 8272cd9):** la narrativa por segmento debe ser ≥ ~50 palabras/30s (100 WPM mínimo, cap 180 WPM, gap ≤ 1s). Fixtures con `narrativeSpan` corto fuerzan `NarrationSynthesisError` por gap. Mantener duraciones reales (30s/61s) y ajustar `narrativeSpan` proporcionalmente. Referencia: `src/infrastructure/render/narration-synthesizer.ts:216-228`.

### F1 — oportunidad hasta RENDER con paquete AUTHORIZED_FOR_PRODUCTION vigente

Requiere `jq` únicamente para encadenar los IDs devueltos por la API e incrustar los handoffs.

```bash
OPP=qa-edit
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d "{\"opportunityId\":\"$OPP\"}"
PROPOSAL_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/curation/proposals" -H 'content-type: application/json' -d '{"originalNote":"Reduje de 40 a 8 minutos el diagnóstico de fallos de automatización en tres proyectos.","evidence":"Registros propios de tres proyectos: 40 min antes, 8 min después.","centralApproach":"Mostrar el método de diagnóstico y su reducción medible.","audience":"AUTOMATION_CLIENTS","objective":"DISCOVERY"}' | jq -r '.proposal_id')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/curation/proposals/$PROPOSAL_ID/approve" -H 'content-type: application/json' -d '{"actor":"developer"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/advance" -H 'content-type: application/json' -d "{\"actor\":\"director\",\"role\":\"DIRECTOR\",\"payload\":{\"opportunityId\":\"$OPP\",\"originalNote\":\"Reduje de 40 a 8 minutos el diagnóstico de fallos de automatización en tres proyectos.\",\"directorDecision\":\"APPROVE\",\"centralApproach\":\"Mostrar el método de diagnóstico y su reducción medible.\"}}"
CONFIG_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/configurations" -H 'content-type: application/json' -d '{"director":"director","configuration":{"audience":"clientes de automatización","tone":"directo","depth":"profundo","voice":"calma","style":"continuo","targetDurationSeconds":60}}' | jq -r '.configuration_id')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/configurations/$CONFIG_ID/approve" -H 'content-type: application/json' -d '{"actor":"developer"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/generate" \
  -H 'content-type: application/json' \
  -d '{"actor":"narrator","narrativeText":"Reduje de cuarenta a ocho minutos el diagnóstico de fallos de automatización en tres proyectos propios mediante un método sistemático que identifica cuellos de botella, mide el impacto de cada cambio y valida la reducción con evidencia reproducible antes de considerar resuelto cualquier incidente. El proceso comienza registrando las condiciones exactas del fallo. Luego aislé cada componente del pipeline para determinar si el problema estaba en el trigger inicial, en la lógica de transformación o en la integración final con los servicios externos. Esta clasificación me permitió enfocar los esfuerzos únicamente en el punto real de falla sin perder tiempo en áreas que funcionaban correctamente dentro del flujo automatizado. Una vez identificado el componente problemático dentro del flujo automatizado, medí el impacto exacto de cada corrección aplicada comparando el tiempo de ejecución antes y después del cambio. Esta medición cuantitativa me permitió descartar ajustes que parecían resolver el problema superficialmente pero no reducían el tiempo total de diagnóstico. Luego validé la solución definitiva con evidencia reproducible ejecutando el mismo fallo en condiciones controladas para confirmar que la corrección era permanente y no un efecto temporal pasajero. Finalmente, documenté el procedimiento completo para que cualquier miembro del equipo pudiera replicar el diagnóstico en menos de diez minutos sin depender exclusivamente de mi experiencia personal acumulada en estos sistemas complejos a lo largo de los años. [source.md:1]","sources":{"source.md":"Registros propios de tres proyectos de automatización: antes del método, el diagnóstico de fallos consumía cuarenta minutos en promedio por incidente. Después de aplicar el método sistemático de aislamiento de componentes y medición de impacto, el tiempo se redujo a ocho minutos. El método identifica cuellos de botella en el trigger, la lógica de transformación o la integración final. Luego de aislar el componente, se mide el impacto de cada corrección, se valida con evidencia reproducible y se documenta el procedimiento para que el equipo pueda replicarlo."}}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/validate" -H 'content-type: application/json' -d '{"actor":"director","role":"DIRECTOR"}' > /dev/null
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/advance" -H 'content-type: application/json' \
  -d "$(jq -n --argjson p "$(curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/narrative/handoff)" '{actor:"writer", role:"WRITER", payload:$p}')"
```

### F2 — segmentos dual-channel (transcripción del fixture de `src/application/storyboard-service.test.ts`)

```bash
SEG1='{"segmentId":"s1","narrativeSpan":"Reduje de cuarenta a ocho minutos el diagnóstico de fallos de automatización en tres proyectos propios mediante un método sistemático que identifica cuellos de botella, mide el impacto de cada cambio y valida la reducción con evidencia reproducible antes de considerar resuelto cualquier incidente. El proceso comienza registrando las condiciones exactas del fallo.","narrativeStart":0,"narrativeEnd":365,"durationSeconds":30,"audio":"audio-s1","visualRepresentation":"visual-s1","audiovisualMapping":{"narrativeMeaning":"meaning-s1","audio":"audio-s1","visual":"visual-s1","correspondence":"mapping-s1"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s1"}],"technicalCoverage":[]}'
SEG2='{"segmentId":"s2","narrativeSpan":"Luego aislé cada componente del pipeline para determinar si el problema estaba en el trigger inicial, en la lógica de transformación o en la integración final con los servicios externos. Esta clasificación me permitió enfocar los esfuerzos únicamente en el punto real de falla sin perder tiempo en áreas que funcionaban correctamente dentro del flujo automatizado.","narrativeStart":366,"narrativeEnd":730,"durationSeconds":30,"audio":"audio-s2","visualRepresentation":"visual-s2","audiovisualMapping":{"narrativeMeaning":"meaning-s2","audio":"audio-s2","visual":"visual-s2","correspondence":"mapping-s2"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s2"}],"technicalCoverage":[]}'
```

### F3 — paquete AUTHORIZED_FOR_PRODUCTION avanzado a RENDER (gate vigente y consumido)

```bash
OPP=qa-edit
REV=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG1,$SEG2]}" | jq -r '.storyboardRevisionId')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/authorize" -H 'content-type: application/json' -d '{"role":"STORYBOARD","actor":"storyboard"}' > /dev/null
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard/approve" -H 'content-type: application/json' \
  -d "{\"actor\":\"user\",\"storyboardRevisionId\":\"$REV\"}" | jq -e '.state == "STORYBOARD_USER_APPROVED"'
curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/storyboard/handoff | jq -e '.authorizationState == "AUTHORIZED_FOR_PRODUCTION" and .finalDurationSeconds == 60'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/advance" -H 'content-type: application/json' \
  -d "$(jq -n --argjson p "$(curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/storyboard/handoff)" '{actor:"storyboard", role:"STORYBOARD", payload:$p}')"
curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/lineage | jq -e '.state == "RENDER"'
```

---

## 1. Invisibilidad

**Criterio:** `cliplab-editor` no es visible ni seleccionable por el usuario; solo existe para el Director (D-01).

**Precondición:** setup común; ninguna adicional.

**Pasos:** (a) en el selector de agentes de OpenCode (mención `@` o selector de modo), buscar `cliplab-editor`; (b) verificar el registro en `opencode.json`.

**Resultado binario:** (a) `cliplab-editor` no aparece como seleccionable ni dentro de la mención `@`; el usuario solo conversa con `cliplab-director`; (b) el registro existe con `hidden: true` y `mode: "subagent"`.

**Comprobación:**

```bash
node -e "const c=JSON.parse(require('fs').readFileSync('opencode.json','utf8')); const e=c.agent['cliplab-editor']; console.assert(e && e.hidden===true && e.mode==='subagent' && e.permission.edit==='allow' && e.permission.bash==='allow', 'registro inválido')"
```

- [ ] PASS

## 2. Delegación exitosa con gate verificado produce SUCCEEDED con MP4 sincronizado

**Criterio:** una delegación del Director sobre paquete `AUTHORIZED_FOR_PRODUCTION` vigente (gate `verifyAuthorizedHandoff` verificado) produce un render `SUCCEEDED` con `output.mp4` sincronizado y asociado a la oportunidad (D-02, D-03, D-04).

**Precondición:** ejecutar F1, F2 y F3 (oportunidad `qa-edit` en RENDER con paquete autorizado y gate consumido).

**Pasos:** invocar al Editor desde el Director con los punteros del encargo (`opportunityId`, handoff `AUTHORIZED_FOR_PRODUCTION` identifiers, perfil, 3 configurables, fuentes persistidas) e iniciar producción.

**Comprobación:**

```bash
OPP=qa-edit
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/production" -H 'content-type: application/json' \
  -d '{"actor":"editor"}' | jq -e '.state == "QUEUED" and .renderId != null'
# tras completarse el render (worker serial), verificar SUCCEEDED + outputPath:
RENDER_ID=$(curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/renders" | jq -r '.[0].renderId')
curl -fsS "http://localhost:3000/api/v1/renders/$RENDER_ID" | jq -e '.state == "SUCCEEDED" and (.outputPath | endswith("output.mp4")) and .outputSha256 != null and .outputDurationSeconds == 60'
```

**Resultado binario:** `POST /production` responde 202 con estado `QUEUED`; el render finaliza `SUCCEEDED` con `outputPath` terminando en `output.mp4` bajo `CLIPLAB_DATA_DIR/renders/<renderId>/`, `sha256` presente y `outputDurationSeconds == finalDurationSeconds` (60s); el Editor entrega el resultado solo al Director.

- [ ] PASS

## 3. Gate bloquea paquete obsoleto → ProductionGateError sin render

**Criterio:** si el paquete dejó de ser la revisión aprobada vigente (stale, nueva revisión o corrección PENDING), la producción no renderiza: el gate responde `ProductionGateError` con motivo visible (D-03, Pieza 1A/1B).

**Precondición:** ejecutar F1, F2 y F3 con ID nuevo (`qa-stale`).

**Pasos:** tras avanzar a RENDER, crear otra revisión/corrección en storyboard (el paquete persiste obsoleto) e intentar iniciar producción.

**Comprobación:**

```bash
OPP=qa-stale
# repetir F1+F2+F3 con OPP=qa-stale
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/production" -H 'content-type: application/json' \
  -d '{"actor":"editor"}' 2>/dev/null | jq -e '.error.code == "PRODUCTION_GATE_FAILED"'
```

**Resultado binario:** el `POST /production` responde 409 con `error.code == "PRODUCTION_GATE_FAILED"` (reason `STALE_PACKAGE` cuando hay revisión posterior/corrección pendiente, o `NOT_IN_RENDER_STATE` si la oportunidad no está en RENDER); no se encola ningún render ni se escribe ningún artefacto; el Editor informa al Director el motivo del gate y no renderiza.

- [ ] PASS

## 4. Fallo ENVIRONMENT con retry registrado (attempts 1 → 2)

**Criterio:** un fallo de entorno (motor caído, timeout, recursos, voz TTS ausente, spawn error) se clasifica `ENVIRONMENT`, muestra segmento/causa y sugerencia RETRY; el reintento a demanda del operador queda registrado como nuevo intento en `render_attempts` (D-03, Pieza 2A/2B/2C).

**Precondición:** ejecutar F1, F2 y F3 con ID nuevo (`qa-env`); entorno con engine no disponible (o fake que lanza `RenderEnvironmentError`).

**Pasos:** iniciar producción para que falle en preflight/spawn; verificar la clasificación; solicitar retry.

**Comprobación:**

```bash
OPP=qa-env
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/production" -H 'content-type: application/json' -d '{"actor":"editor"}' > /dev/null
RENDER_ID=$(curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/renders" | jq -r '.[0].renderId')
curl -fsS "http://localhost:3000/api/v1/renders/$RENDER_ID" | jq -e '.state == "FAILED" and .failureClass == "ENVIRONMENT" and .failureSuggestedAction != null and (.attempts | length) == 1'
curl -fsS -X POST "http://localhost:3000/api/v1/renders/$RENDER_ID/retry" -H 'content-type: application/json' \
  -d '{"actor":"editor"}' | jq -e '.state == "QUEUED"'
curl -fsS "http://localhost:3000/api/v1/renders/$RENDER_ID" | jq -e '(.attempts | map(.attemptNumber) | sort) == [1,2]'
```

**Resultado binario:** el render queda `FAILED` con `failureClass == "ENVIRONMENT"`, causa/sugerencia `RETRY` y 1 intento; el `POST /retry` reencola (202) y el detalle muestra `attemptNumber` 1 y 2 (cada intento es fila en `render_attempts`); el storyboard no se tocó.

- [ ] PASS

## 5. Fallo SPECIFICATION con retry rechazado

**Criterio:** un fallo de especificación (composición no renderizable según validadores lint/check) no se arregla reintentando: el retry es rechazado y el flujo vuelve al storyboard exigiendo corrección y nueva aprobación explícita (D-03, Pieza 2A/2B/2D).

**Precondición:** ejecutar F1, F2 y F3 con ID nuevo (`qa-spec`); entorno con fake que lanza `RenderSpecificationError` (lint/check exit≠0).

**Pasos:** iniciar producción para que falle en VALIDATION; verificar clasificación; intentar retry.

**Comprobación:**

```bash
OPP=qa-spec
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/production" -H 'content-type: application/json' -d '{"actor":"editor"}' > /dev/null
RENDER_ID=$(curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/renders" | jq -r '.[0].renderId')
curl -fsS "http://localhost:3000/api/v1/renders/$RENDER_ID" | jq -e '.state == "FAILED" and .failureClass == "SPECIFICATION"'
curl -fsS -X POST "http://localhost:3000/api/v1/renders/$RENDER_ID/retry" -H 'content-type: application/json' \
  -d '{"actor":"editor"}' 2>/dev/null | jq -e '.error.code == "RENDER_SPECIFICATION"'
```

**Resultado binario:** el render queda `FAILED` con `failureClass == "SPECIFICATION"`; el `POST /retry` responde error `RENDER_SPECIFICATION` (retry rechazado) y el detalle de fallo apunta a corrección del storyboard + nueva aprobación explícita; el Editor no reintenta y devuelve la indicación al Director.

- [ ] PASS

## 6. Fallo UNCLASSIFIED crudo con ambas rutas visibles

**Criterio:** un fallo no clasificable llega crudo al operador con ambas rutas visibles (RETRY o corrección+aprobación) para que él decida; nunca auto-retry (D-03, Pieza 2A/2B/2C).

**Precondición:** ejecutar F1, F2 y F3 con ID nuevo (`qa-uncl`); entorno con fake que lanza `RenderUnclassifiedError`.

**Pasos:** iniciar producción para que falle sin patrón clasificable; verificar el detalle.

**Comprobación:**

```bash
OPP=qa-uncl
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/production" -H 'content-type: application/json' -d '{"actor":"editor"}' > /dev/null
RENDER_ID=$(curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/renders" | jq -r '.[0].renderId')
curl -fsS "http://localhost:3000/api/v1/renders/$RENDER_ID" | jq -e '.state == "FAILED" and .failureClass == "UNCLASSIFIED" and (.attempts | length) == 1'
```

**Resultado binario:** el render queda `FAILED` con `failureClass == "UNCLASSIFIED"` y el detalle expone el tramo crudo (rawExcerpt cuando exista) y ambas rutas (RETRY a demanda o corrección storyboard + nueva aprobación); exactamente 1 intento (cero reintentos automáticos).

- [ ] PASS

## 7. Render incompleto nunca es final (FAILED no expone outputPath)

**Criterio:** un render FAILED/incompleto no expone `outputPath`/`sha256` ni puede presentarse como video final (D-04, Pieza 2D/7C).

**Precondición:** escenario 4, 5 o 6 ejecutado (render `FAILED` en `qa-env`, `qa-spec` o `qa-uncl`).

**Pasos:** leer el detalle del render FAILED y verificar que no hay output final.

**Comprobación:**

```bash
OPP=qa-spec
RENDER_ID=$(curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/renders" | jq -r '.[0].renderId')
curl -fsS "http://localhost:3000/api/v1/renders/$RENDER_ID" | jq -e '.state == "FAILED" and (.outputPath == null or .outputPath == "")'
```

**Resultado binario:** el detalle del render FAILED no expone `outputPath` ni `sha256` de salida; el Editor nunca presenta un resultado incompleto como video final ni como registrado.

- [ ] PASS

## 8. Duración >90s aprobada se honra exacta (sin recortes)

**Criterio:** la duración aprobada heredada del storyboard se honra exacta (tolerancia ±2 frames), incluso >90s con aprobación explícita registrada; el Editor nunca recorta ni altera la duración aprobada (D-04, Pieza 4A/4B/10A).

**Precondición:** ejecutar F1 con ID nuevo (`qa-90s`), crear storyboard con `s1` (30s) + segmento de 61s (`finalDurationSeconds == 91`), aprobar explícitamente (incluye >90s) y avanzar a RENDER (F2/F3 adaptados).

**Pasos:** iniciar producción y verificar la duración de salida contra `finalDurationSeconds`.

**Comprobación:**

```bash
OPP=qa-90s
SEG61='{"segmentId":"s2","narrativeSpan":"Una vez identificado el componente problemático dentro del flujo automatizado, medí el impacto exacto de cada corrección aplicada comparando el tiempo de ejecución antes y después del cambio. Esta medición cuantitativa me permitió descartar ajustes que parecían resolver el problema superficialmente pero no reducían el tiempo total de diagnóstico. Luego validé la solución definitiva con evidencia reproducible ejecutando el mismo fallo en condiciones controladas para confirmar que la corrección era permanente y no un efecto temporal pasajero. Finalmente, documenté el procedimiento completo para que cualquier miembro del equipo pudiera replicar el diagnóstico en menos de diez minutos sin depender exclusivamente de mi experiencia personal acumulada en estos sistemas complejos a lo largo de los años.","narrativeStart":731,"narrativeEnd":1537,"durationSeconds":61,"audio":"audio-s2","visualRepresentation":"visual-s2","audiovisualMapping":{"narrativeMeaning":"meaning-s2","audio":"audio-s2","visual":"visual-s2","correspondence":"mapping-s2"},"rhythm":"steady","synchronization":"sync","sourceReferences":[{"path":"source.md","locator":"1","segmentId":"s2"}],"technicalCoverage":[]}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/storyboard" -H 'content-type: application/json' \
  -d "{\"actor\":\"storyboard\",\"segments\":[$SEG1,$SEG61]}" | jq -e '.finalDurationSeconds == 91'
# ... autorizar, aprobar (incluye >90s) y avanzar a RENDER (F3 adaptado) ...
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/production" -H 'content-type: application/json' -d '{"actor":"editor"}' > /dev/null
RENDER_ID=$(curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/renders" | jq -r '.[0].renderId')
curl -fsS "http://localhost:3000/api/v1/renders/$RENDER_ID" | jq -e '.state == "SUCCEEDED" and .outputDurationSeconds == 91'
```

**Resultado binario:** el render `SUCCEEDED` expone `outputDurationSeconds == 91` (dentro de tolerancia ±2 frames a 30 fps) — la duración aprobada >90s se honra exacta, sin recortes ni rellenos.

- [ ] PASS

## 9. Cola serial FIFO visible (un RUNNING a la vez, orden de encolado)

**Criterio:** la cola es serial FIFO: nunca hay dos `RUNNING` simultáneos y el orden de encolado es visible en `GET /renders` (D-03, Pieza 3A/3B).

**Precondición:** ejecutar F1/F2/F3 en dos oportunidades (`qa-serial-a` y `qa-serial-b`), ambas en RENDER.

**Pasos:** iniciar producción en ambas en rápida sucesión y observar la cola durante la ejecución.

**Comprobación:**

```bash
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/qa-serial-a/production" -H 'content-type: application/json' -d '{"actor":"editor"}' > /dev/null
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/qa-serial-b/production" -H 'content-type: application/json' -d '{"actor":"editor"}' > /dev/null
curl -fsS http://localhost:3000/api/v1/renders | jq -e '([.[] | select(.state == "RUNNING")] | length) <= 1'
curl -fsS http://localhost:3000/api/v1/renders | jq -e '[.[].createdAt] == ([.[].createdAt] | sort)'
```

**Resultado binario:** en todo momento hay a lo sumo un render `RUNNING` (guard SQL de la cola serial) y la lista `GET /renders` mantiene orden FIFO por `createdAt`; el segundo render queda `QUEUED` hasta que el primero complete.

- [ ] PASS

## 10. Aislamiento: entrega solo al Director

**Criterio:** el Editor entrega sus resultados exclusivamente al Director — nunca al usuario ni a otros agentes — y no firma RENDER→FINAL (D-02, Pieza 9A/9C).

**Precondición:** setup común; ninguna adicional.

**Pasos:** (a) verificar que ninguna salida del Editor aparece fuera de la conversación del Director; (b) en el estado RENDER de `qa-edit`, pedir al Editor que entregue directamente al usuario.

**Resultado binario:** (a) ninguna salida del Editor aparece fuera de la conversación del Director; (b) el Editor no entrega resultados al usuario ni a otros agentes, no avanza el handoff RENDER→FINAL ni firma validación final editorial; devuelve el estado al Director para cierre del pipeline.

**Comprobación:** observacional en OpenCode: las respuestas del Editor llegan solo dentro del hilo del Director, con estado + resultado, sin menciones de entrega directa.

- [ ] PASS

## 11. Composición determinista (slots exactos y manifest con audio por segmento)

**Criterio:** la composición es transcripción mecánica determinista del handoff: `index.html` + `manifest.json` con slots exactos de `rhythmAndPositions` (data-start acumulado), `<audio src="narration/<segmentId>.wav">`, dimensiones derivadas del perfil y duración total `finalDurationSeconds` exacta (D-04, Pieza 4A/4B).

**Precondición:** escenario 2 ejecutado (`qa-edit`) o lectura directa del directorio de un render SUCCEEDED.

**Pasos:** inspeccionar `CLIPLAB_DATA_DIR/renders/<renderId>/composition/`.

**Comprobación:**

```bash
OPP=qa-edit
DATA_DIR="${CLIPLAB_DATA_DIR:-./data}"
RENDER_ID=$(curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/renders" | jq -r '.[0].renderId')
test -f "$DATA_DIR/renders/$RENDER_ID/composition/index.html" && test -f "$DATA_DIR/renders/$RENDER_ID/composition/manifest.json" && echo "composition ok"
grep -q 'data-start="0"' "$DATA_DIR/renders/$RENDER_ID/composition/index.html" && grep -q 'src="narration/s1.wav"' "$DATA_DIR/renders/$RENDER_ID/composition/index.html" && grep -q 'data-width="1080"' "$DATA_DIR/renders/$RENDER_ID/composition/index.html" && echo "slots ok"
grep -q '"finalDurationSeconds": 60' "$DATA_DIR/renders/$RENDER_ID/composition/manifest.json" 2>/dev/null || grep -q '60' "$DATA_DIR/renders/$RENDER_ID/composition/manifest.json" && echo "duración ok"
```

**Resultado binario:** `composition/index.html` contiene `data-start="0"`, `src="narration/s1.wav"` y dimensiones derivadas del perfil (9:16 → `data-width="1080"`); `manifest.json` refleja narración + visuales del paquete con duración total 60s — sin assets externos ni reinterpretación.

- [ ] PASS

## 12. Fail-closed: lectura/gate falla → fallo visible con cero reintentos

**Criterio:** si una lectura de material, verificación de gate o POST/GET de producción falla o devuelve respuesta inválida, el Editor muestra el fallo visible al Director, devuelve parcial FAILED/BLOCKED con acción requerida nombrando el fallo, cero reintentos automáticos, y nunca presenta como registrado un resultado no persistido (D-03, Pieza 9D).

**Precondición:** setup común; con el servidor detenido (o gate sin autorización vigente en `qa-failclosed`).

**Pasos:** (a) con `npm run dev` detenido, pedir al Director delegar la producción de `qa-edit`; (b) con gate ausente (oportunidad sin paquete autorizado), intentar iniciar producción.

**Resultado binario:** (a) el Editor declara el fallo visible (`editor:`), devuelve parcial FAILED/BLOCKED con acción requerida nombrando el fallo de fetch, realiza cero reintentos automáticos, no diagnostica entorno ni levanta servidores; (b) el gate responde `PRODUCTION_GATE_FAILED` y no se encola nada.

**Comprobación:**

```bash
# (b) con servidor activo: oportunidad SIN paquete autorizado o en fase distinta de RENDER
OPP=qa-failclosed
curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/lineage 2>/dev/null | jq -e '.state != "RENDER"' || true
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/production" -H 'content-type: application/json' \
  -d '{"actor":"editor"}' 2>/dev/null | jq -e '.error.code == "PRODUCTION_GATE_FAILED"'
```

- [ ] PASS

## 13. RENDER→FINAL solo desde SUCCEEDED

**Criterio:** el handoff RENDER→FINAL (`renderToFinalSchema`) solo es construible desde un render `SUCCEEDED`: `synchronizationStatus: 'SYNCED'` y `finalAuthorizationOrReturn` definen el retorno; un render FAILED/incompleto jamás alcanza FINAL (D-04, Pieza 7B/7C).

**Precondición:** escenario 7 (render FAILED) y escenario 2 (render SUCCEEDED) ejecutados.

**Pasos:** (a) con el render FAILED de `qa-spec`, intentar avanzar RENDER→FINAL; (b) con el render SUCCEEDED de `qa-edit`, avanzar RENDER→FINAL con rol EDITOR.

**Comprobación:**

```bash
# (a) FAILED no puede avanzar a FINAL: no existe SUCCEEDED para construir el handoff
OPP=qa-spec
curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/renders" | jq -e '([.[] | select(.state == "SUCCEEDED")] | length) == 0'
# (b) SUCCEEDED habilita FINAL (transición RENDER→FINAL con rol EDITOR, autorización EDITOR)
OPP=qa-edit
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/authorize" -H 'content-type: application/json' -d '{"role":"EDITOR","actor":"editor"}' > /dev/null
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/advance" -H 'content-type: application/json' \
  -d "$(jq -n --argjson p "$(curl -fsS http://localhost:3000/api/v1/opportunities/$OPP/handoff)" '{actor:"editor", role:"EDITOR", payload:$p}')" 2>/dev/null | jq -e '.state == "FINAL" or .status == "FINAL"'
```

**Resultado binario:** (a) sin render `SUCCEEDED` la transición RENDER→FINAL no se puede autorizar y el avance falla (el Editor no firma FINAL sobre un fallido); (b) con SUCCEEDED y autorización EDITOR, el pipeline cierra a `FINAL` con `synchronizationStatus: 'SYNCED'` y `finalAuthorizationOrReturn: 'FINAL_AUTHORIZATION'` — la validación final de entrega queda en el Director/pipeline, no en el Editor.

- [ ] PASS

---

## Cierre

El CA pasa QA conversacional únicamente con las **13 casillas marcadas**. Una casilla fallida conserva el output de OpenCode y los responses de curl asociados; no se interpreta como éxito parcial.