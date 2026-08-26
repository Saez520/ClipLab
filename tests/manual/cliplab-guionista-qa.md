# QA manual — `cliplab-guionista`

Este protocolo valida los criterios del CA `ca-agente-guionista`. Cada escenario es binario: se marca `[x]` únicamente si se cumple todo su resultado observable.

## Setup común

1. Desde la raíz del repositorio, ejecutar `npm run dev` y mantener el proceso activo.
2. Verificar soporte: `curl -fsS http://localhost:3000/health` debe responder `{"status":"ok"}`.
3. Abrir OpenCode en esta raíz y seleccionar el agente primario `cliplab-director`.
4. Usar IDs distintos por escenario para evitar estado compartido.

## Fixtures

### F1 — oportunidad lista para generar guion (curación aprobada + NOTE→SCRIPT + configuración aprobada)

Requiere `jq` únicamente para encadenar los IDs devueltos por la API.

```bash
OPP=qa-guion
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d "{\"opportunityId\":\"$OPP\"}"
PROPOSAL_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/curation/proposals" -H 'content-type: application/json' -d '{"originalNote":"Reduje de 40 a 8 minutos el diagnóstico de fallos de automatización en tres proyectos.","evidence":"Registros propios de tres proyectos: 40 min antes, 8 min después.","centralApproach":"Mostrar el método de diagnóstico y su reducción medible.","audience":"AUTOMATION_CLIENTS","objective":"DISCOVERY"}' | jq -r '.proposal_id')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/curation/proposals/$PROPOSAL_ID/approve" -H 'content-type: application/json' -d '{"actor":"developer"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/advance" -H 'content-type: application/json' -d "{\"actor\":\"director\",\"role\":\"DIRECTOR\",\"payload\":{\"opportunityId\":\"$OPP\",\"originalNote\":\"Reduje de 40 a 8 minutos el diagnóstico de fallos de automatización en tres proyectos.\",\"directorDecision\":\"APPROVE\",\"centralApproach\":\"Mostrar el método de diagnóstico y su reducción medible.\"}}"
CONFIG_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/configurations" -H 'content-type: application/json' -d '{"director":"director","configuration":{"audience":"clientes de automatización","tone":"directo","depth":"profundo","voice":"calma","style":"continuo","targetDurationSeconds":60}}' | jq -r '.configuration_id')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/configurations/$CONFIG_ID/approve" -H 'content-type: application/json' -d '{"actor":"developer"}'
```

### F2 — guion con referencia de líneas resoluble

```bash
OPP=qa-guion
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/generate" \
  -H 'content-type: application/json' \
  -d '{"actor":"narrator","narrativeText":"El diagnóstico de fallos bajó de cuarenta a ocho minutos. [src/example.ts:1-2]","sources":{"src/example.ts":"const before = 40;\nconst after = 8;\n"}}'
```

### F3 — guion con referencia de sección resoluble (solo `.md`)

```bash
OPP=qa-guion
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/generate" \
  -H 'content-type: application/json' \
  -d '{"actor":"narrator","narrativeText":"El método se apoya en registros propios medidos antes y después. [docs/example.md:medición]","sources":{"docs/example.md":"# Medición\n\nCuarenta minutos antes, ocho después."}}'
```

---

## 1. Invisibilidad

**Criterio:** `cliplab-guionista` no es visible ni seleccionable por el usuario; solo existe para el Director (c-1 del CA).

**Precondición:** setup común; ninguna adicional.

**Pasos:** (a) en el selector de agentes de OpenCode (mención `@` o selector de modo), buscar `cliplab-guionista`; (b) verificar el registro en `opencode.json`.

**Resultado binario:** (a) `cliplab-guionista` no aparece como seleccionable ni dentro de la mención `@`; el usuario solo conversa con `cliplab-director`; (b) el registro existe con `hidden: true` y `mode: "subagent"`.

**Comprobación:**

```bash
node -e "const c=JSON.parse(require('fs').readFileSync('opencode.json','utf8')); const g=c.agent['cliplab-guionista']; console.assert(g && g.hidden===true && g.mode==='subagent', 'registro inválido')"
```

- [ ] PASS

## 2. Delegación exitosa con texto continuo

**Criterio:** una delegación del Director con `opportunityId`, material indicado y configurables aprobados produce texto narrativo continuo sin títulos/indicaciones visuales, fiel al `centralApproach`, entregado solo al Director (c-2).

**Precondición:** ejecutar F1.

**Pasos:** en la conversación con el Director, invocar al Guionista pasando los siete campos del contrato (`opportunityId`, `configurationId`, `centralApproach`, `punteros`, `configurables`, `actor: narrator`, `materialGap` vacío) y pedir el guion de la oportunidad.

**Resultado binario:** el Guionista resuelve los punteros, escribe prosa continua fiel al enfoque aprobado (sin títulos, sin enumeraciones de escena, sin indicaciones visuales), persiste el guion y devuelve el texto con estado `READY_FOR_DIRECTOR_VALIDATION`, solo dentro de la conversación del Director.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-guion/narrative/scripts | jq -e '.state == "READY_FOR_DIRECTOR_VALIDATION" and .actor == "narrator"'
```

- [ ] PASS

## 3. Referencias resolubles por líneas

**Criterio:** afirmación técnica respaldada por código usa `[ruta/relativa/archivo.ts:12-15]` y la fuente resuelve contra `sources` (c-3, variante líneas).

**Precondición:** ejecutar F1 y F2 (el guion cita `[src/example.ts:1-2]` con `sources` provisto).

**Pasos:** generar el guion con F2 y leer el script persistido.

**Resultado binario:** el `generate` responde 201; el script queda en `READY_FOR_DIRECTOR_VALIDATION` y su campo `references` contiene la referencia parseada con `path: "src/example.ts"`, `locator: "lines"`, `startLine: 1`, `endLine: 2`.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-guion/narrative/scripts | jq -e '.state == "READY_FOR_DIRECTOR_VALIDATION" and (.references | length) == 1 and .references[0].path == "src/example.ts" and .references[0].locator == "lines"'
```

- [ ] PASS

## 4. Referencias resolubles por sección

**Criterio:** documento sin líneas usa `[ruta/archivo.md:sección]` y la sección resuelve contra los encabezados del `.md` (c-3, variante sección).

**Precondición:** ejecutar F1 y F3 (el guion cita `[docs/example.md:medición]` con `sources` provisto).

**Pasos:** generar el guion con F3 y leer el script persistido.

**Resultado binario:** el `generate` responde 201; `references[0]` tiene `path: "docs/example.md"`, `locator: "section"` y `section` resuelto. Una referencia de sección en un path que no termina en `.md` es rechazada (solo Markdown admite sección).

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-guion/narrative/scripts | jq -e '.references[0].locator == "section" and .references[0].path == "docs/example.md"'
```

- [ ] PASS

## 5. Referencia no resoluble: el guion no se declara final

**Criterio:** una referencia fuera de formato o sin fuente resoluble impide declarar el guion listo; se solicita corrección o aclaración (c-3 negativo).

**Precondición:** ejecutar F1 con un ID nuevo (`qa-ref-rota`).

```bash
OPP=qa-ref-rota
# repetir F1 con OPP=qa-ref-rota
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/generate" \
  -H 'content-type: application/json' \
  -d '{"actor":"narrator","narrativeText":"Afirmación sin origen resoluble. [missing.ts:99]","sources":{}}'
```

**Pasos:** generar el guion con una referencia cuyo path no existe en `sources`.

**Resultado binario:** el `generate` responde 400 con `error.code == "VALIDATION_ERROR"`; no se crea ningún script y el Guionista no entrega el texto como final: devuelve al Director la referencia no resoluble y pide corrección o aclaración.

**Comprobación:**

```bash
# el curl del generate sale distinto de 0 (HTTP 400) y el script no queda persistido:
curl -fsS http://localhost:3000/api/v1/opportunities/qa-ref-rota/narrative/scripts 2>/dev/null | jq -e 'has("state") | not'
```

- [ ] PASS

## 6. Referencias como metadatos: no se locutan ni computan

**Criterio:** las referencias inline no se locutan, no se subtitulan y no computan para duración (c-4).

**Precondición:** ejecutar F1 y F2.

**Pasos:** leer el script persistido y verificar dónde viven las referencias.

**Resultado binario:** el guion persistido conserva `narrativeText` (texto continuo con los tokens) y las referencias parseadas por separado en `references`; son metadatos de producción que el Guionista declara fuera de locución/subtítulos/duración (`textWithoutReferences` con `replace(referenceToken,'')` sin trim). La duración final pertenece al storyboard.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-guion/narrative/scripts | jq -e '(.references | length) >= 1 and (.narrativeText | contains("src/example.ts"))'
```

- [ ] PASS

## 7. Storyboard no prescrito

**Criterio:** el Guionista no entrega decisiones visuales: no produce `conceptsOnScreen`, `preciseConcepts`, cues, timing ni duración final; el storyboard decide qué/cómo/cuándo y la duración (c-5).

**Precondición:** ejecutar F1 y F2.

**Pasos:** inspeccionar el guion persistido y verificar que el handoff SCRIPT→STORYBOARD no avanza sin validación del Director.

**Resultado binario:** el guion no contiene `conceptsOnScreen`, `preciseConcepts`, cues de sincronización ni instrucciones de escena; el handoff narrativo (`GET .../narrative/handoff`) responde error de autorización mientras el guion no esté `DIRECTOR_VALIDATED` — el Guionista no avanzó ni firmó ningún handoff.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-guion/narrative/handoff 2>/dev/null | jq -e '.error.code == "AUTHORIZATION_REQUIRED"'
```

- [ ] PASS

## 8. Vacío que cambia el sentido: BLOCKED, sin parcial como final

**Criterio:** ante vacío material que cambia el sentido narrativo, el trabajo vuelve al Director, queda `BLOCKED` y no se entrega parcial ni se completa con invención (c-6).

**Precondición:** ejecutar F1 con un ID nuevo (`qa-gap`).

```bash
OPP=qa-gap
# repetir F1 con OPP=qa-gap
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/generate" \
  -H 'content-type: application/json' \
  -d '{"actor":"narrator","narrativeText":"El resultado depende de un dato central.","sources":{},"materialGap":"Falta el dato central que sostiene el sentido de la pieza."}'
```

**Pasos:** generar el guion con `materialGap` presente.

**Resultado binario:** el `generate` responde 409 con `error.code == "NARRATIVE_BLOCKED"` y deja un script en `BLOCKED` con la razón; el Guionista devuelve al Director `BLOCKED` + razón (nunca el texto parcial como final) y no rellena el vacío con invención.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-gap/narrative/scripts | jq -e '.state == "BLOCKED" and .blockedReason != null'
```

- [ ] PASS

## 9. Validación del Director: VALIDADO y handoff habilitado

**Criterio:** el Director lee el guion completo, emite VALIDADO (`validate` con `{actor:"director", role:"DIRECTOR"}`) y solo entonces el handoff SCRIPT→STORYBOARD es posible (c-7).

**Precondición:** ejecutar F1 y F2 (guion en `READY_FOR_DIRECTOR_VALIDATION`).

**Pasos:** pedir al Director “Validá el guion completo de `qa-guion`”.

**Resultado binario:** el Director lee el guion completo (nunca un resumen), verifica fidelidad → accesibilidad → precisión de referencias → ritmo orientativo ~2.5 palabras/segundo → ausencia de invención → pre-mortem, emite **VALIDADO** y registra `validate`; el script pasa a `DIRECTOR_VALIDATED` y el handoff narrativo responde 200.

**Comprobación:**

```bash
curl -fsS -X POST http://localhost:3000/api/v1/opportunities/qa-guion/narrative/scripts/validate -H 'content-type: application/json' -d '{"actor":"director","role":"DIRECTOR"}' > /dev/null
curl -fsS http://localhost:3000/api/v1/opportunities/qa-guion/narrative/scripts | jq -e '.state == "DIRECTOR_VALIDATED"'
curl -fsS http://localhost:3000/api/v1/opportunities/qa-guion/narrative/handoff | jq -e '.validationStatus == "DIRECTOR_VALIDATED"'
```

- [ ] PASS

## 10. Validación del Director: DEVUELTO con observación al criterio incumplido

**Criterio:** guion con relleno inventado → el Director emite DEVUELTO con observaciones exclusivamente sobre el criterio incumplido, sin reescrituras genéricas (c-7 variante).

**Precondición:** ejecutar F1 con un ID nuevo (`qa-inventado`) y generar con F2 un guion que afirme “de cuarenta a dos minutos” mientras `sources` conserva “a ocho minutos” (referencia sintácticamente válida pero imprecisa).

**Pasos:** pedir al Director “Validá el guion completo de `qa-inventado`”.

**Resultado binario:** el Director detecta la discrepancia contra la fuente, emite **DEVUELTO** y observa únicamente el criterio de precisión de referencias (o el de ausencia de invención), sin reescribir el guion; el script permanece sin validar y el handoff sigue rechazado.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-inventado/narrative/handoff 2>/dev/null | jq -e '.error.code == "AUTHORIZATION_REQUIRED"'
```

- [ ] PASS

## 11. Configuración no aprobada: bloqueo de autorización

**Criterio:** con curación aprobada pero configuración de voz/tono/estilo sin aprobar por el usuario, `generate` es rechazado y el guion queda bloqueado (c-9).

**Precondición:** ejecutar F1 pero **omitiendo** la aprobación de la configuración (no ejecutar el último curl de F1), con ID `qa-noaprob`.

```bash
OPP=qa-noaprob
# repetir F1 con OPP=qa-noaprob sin el approve final de la configuración
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/generate" \
  -H 'content-type: application/json' \
  -d '{"actor":"narrator","narrativeText":"Texto que no debería persistir.","sources":{}}'
```

**Pasos:** intentar generar antes de que el usuario apruebe la configuración.

**Resultado binario:** el `generate` responde 409 con `error.code == "AUTHORIZATION_REQUIRED"` (curation aprobada pero configuración sin `userApproved` / no `READY_TO_GENERATE`); el Guionista no persiste nada, queda bloqueado y no intenta generar hasta que el Director confirme la aprobación.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-noaprob/narrative/scripts 2>/dev/null | jq -e 'has("state") | not'
```

- [ ] PASS

## 12. Idioma de salida

**Criterio:** research original en idioma extranjero → guion en el idioma configurado (español por defecto), conservando términos técnicos y nombres propios (c-10).

**Precondición:** ejecutar F1 con ID `qa-en`, con `originalNote` y `centralApproach` en inglés y configurables con `idioma: español`.

```bash
OPP=qa-en
# repetir F1 con OPP=qa-en usando: originalNote "Cut automated failure diagnostics from 40 to 8 minutes across three projects.", centralApproach "Show the diagnostic method and its measurable reduction."
```

**Pasos:** generar el guion y revisar el texto persistido.

**Resultado binario:** el guion se entrega en español, conservando los términos técnicos y nombres propios en su idioma original (`automation`, `diagnostics`); si una cita textual se traduce, aparece marcada como traducción propia. Ante pérdida de matiz material, el Guionista lo declara y marca BLOCKED o advertencia según criticidad.

**Comprobación:** inspeccionar `narrativeText` del script persistido: texto en español sin jerga técnica traducida forzada.

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-en/narrative/scripts | jq -r '.narrativeText'
```

- [ ] PASS

### 12b. Clarificación tras bloqueo: 409 → 200 y nuevo DRAFT

**Criterio:** tras un `generate` con gap previo (409 + `BLOCKED`), el `clarify` desde `BLOCKED` responde 200 y crea un nuevo script en `DRAFT` (c-8).

**Precondición:** completar el escenario 8 (script `BLOCKED` en `qa-gap`).

```bash
OPP=qa-gap
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/clarify" \
  -H 'content-type: application/json' \
  -d '{"actor":"narrator","narrativeText":"El dato central ya está disponible y sostiene el sentido. [src/example.ts:1-2]","sources":{"src/example.ts":"const before = 40;\nconst after = 8;\n"}}'
```

**Pasos:** el Director, tras aclarar el material con el usuario, re-invoca al Guionista para `clarify` desde el estado `BLOCKED`.

**Resultado binario:** el `clarify` responde 200 y el script recién creado queda en `DRAFT` (solo desde `BLOCKED`; cualquier otro estado es rechazado con `NARRATIVE_STATE_INVALID`). El Guionista continúa el flujo normal desde DRAFT.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-gap/narrative/scripts | jq -e '.state == "DRAFT"'
```

- [ ] PASS

---

## Cierre

El CA pasa QA conversacional únicamente con las **12 casillas marcadas (más la subtarea 12b)**. Una casilla fallida conserva el output de OpenCode y los responses de curl asociados; no se interpreta como éxito parcial.