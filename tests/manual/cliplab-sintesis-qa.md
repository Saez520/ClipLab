# QA manual — `cliplab-sintesis`

Este protocolo valida uno a uno los 10 criterios del CA. Cada escenario es binario: se marca `[x]` únicamente si se cumple todo su resultado observable.

## Setup común

1. Desde la raíz del repositorio, ejecutar `npm run dev` y mantener el proceso activo.
2. Verificar soporte: `curl -fsS http://localhost:3000/health` debe responder `{"status":"ok"}`.
3. Abrir OpenCode en esta raíz y seleccionar el agente primario `cliplab-director`.
4. Usar IDs distintos por escenario para evitar estado compartido.

## Fixtures

### F1 — oportunidad con nota y evidencia propia

```bash
curl -fsS -X POST http://localhost:3000/api/v1/opportunities \
  -H 'content-type: application/json' -d '{"opportunityId":"qa-sintesis"}'
curl -fsS -X POST http://localhost:3000/api/v1/opportunities/qa-sintesis/curation/proposals \
  -H 'content-type: application/json' -d '{"originalNote":"Reduje de 40 a 8 minutos el diagnóstico de fallos de automatización en tres proyectos.","evidence":"Registros propios de tres proyectos: 40 min antes, 8 min después.","centralApproach":"Mostrar el método de diagnóstico y su reducción medible.","audience":"AUTOMATION_CLIENTS","objective":"DISCOVERY"}'
```

### F2 — sesión de síntesis y consulta delegada

Requiere `jq` para capturar el `queryId` devuelto por la delegación.

```bash
OPP=qa-sintesis
SESSION=qa-curation-1
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/synthesis/sessions" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"actor\":\"director\",\"recipient\":\"DIRECTOR\"}"
QUERY_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/synthesis/queries" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"actor\":\"director\",\"recipient\":\"DIRECTOR\",\"query\":\"¿Qué evidencia sostiene la reducción de 40 a 8 minutos y qué faltaría para decidir?\",\"context\":[]}" | jq -r '.queryId')
echo "$QUERY_ID"
```

### F3 — registro de resultado persistido

```bash
OPP=qa-sintesis
SESSION=qa-curation-1
QUERY_ID=<queryId de F2>
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/synthesis/queries/$QUERY_ID/result" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"conclusion\":\"La reducción está sostenida por registros propios.\",\"relevantEvidence\":[\"Registros de tres proyectos: 40 min antes, 8 min después [nota: qa-sintesis]\"],\"uncertainties\":[],\"recommendation\":\"Avanzar con la pieza como caso medible.\",\"partial\":false}"
```

---

## 1. Invisibilidad

**Criterio:** `cliplab-sintesis` no es visible ni seleccionable por el usuario; solo existe para el Director.

**Precondición:** setup común; ninguna adicional.

**Pasos:** en la interfaz de OpenCode, abrir el selector de agentes (mención `@` o selector de modo) y buscar `cliplab-sintesis`.

**Resultado binario:** `cliplab-sintesis` no aparece como seleccionable ni dentro de la mención `@`; el usuario solo puede conversar con `cliplab-director`.

- [ ] PASS

## 2. Delegación exitosa con formato fijo

**Criterios:** la delegación del Director entrega síntesis en estructura fija de 6 secciones, breve por defecto, entregada solo al Director.

**Precondición:** ejecutar F1 y F2.

**Pasos:** en la conversación con el Director, delegar la consulta indicando material registrado (oportunidad activa, notas, decisiones) y pedir respuesta breve.

**Resultado binario:** la respuesta del Director contiene la síntesis con las seis secciones en orden — Conclusión, Evidencia relevante, Incertidumbres o faltantes, Recomendación, Alternativas y riesgos (solo si corresponden), Fuentes (solo si corresponden) — de aproximadamente ~250 palabras, entregada solo a la conversación del Director.

**Comprobación:**

```bash
curl -fsS "http://localhost:3000/api/v1/opportunities/qa-sintesis/synthesis/sessions/qa-curation-1/queries/$QUERY_ID" | jq -e '.recommendation != null and .conclusion != null'
```

- [ ] PASS

## 3. Contexto insuficiente: parcial + faltantes + acción requerida

**Criterio:** ante material insuficiente, ambiguo o contradictorio, devuelve parcial + faltantes/contradicciones + acción requerida, sin datos inventados.

**Precondición:** crear oportunidad vacía y delegar una consulta sobre ella.

```bash
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d '{"opportunityId":"qa-vacia"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/qa-vacia/synthesis/sessions" -H 'content-type: application/json' -d '{"sessionId":"qa-vacia-1","actor":"director","recipient":"DIRECTOR"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/qa-vacia/synthesis/queries" -H 'content-type: application/json' -d '{"sessionId":"qa-vacia-1","actor":"director","recipient":"DIRECTOR","query":"¿Qué tratamiento sostiene esta oportunidad?","context":[]}'
```

**Pasos:** en la conversación con el Director, delegar la consulta con punteros a la oportunidad vacía.

**Resultado binario:** la síntesis se entrega como parcial, con la sección Incertidumbres o faltantes nombrando exactamente qué falta (por ejemplo, ausencia de notas o decisiones) y una acción requerida para el Director; no se presenta ningún dato como hecho sin origen.

**Comprobación (tras el POST del resultado):**

```bash
curl -fsS "http://localhost:3000/api/v1/opportunities/qa-vacia/synthesis/sessions/qa-vacia-1/queries/$QUERY_ID_VACIA" | jq -e '.partial == true and .actionRequired != null and (.uncertainties | length) > 0'
```

- [ ] PASS

## 4. Ampliación sin sustituir hechos por supuestos

**Criterio:** ante pedido de ampliación del Director, expande información relevante sin sustituir hechos por supuestos.

**Precondición:** completar el escenario 2.

**Pasos:** pedir al Director "ampliá la síntesis" o solicitar profundidad ampliada sobre la misma consulta.

**Resultado binario:** la respuesta ampliada agrega evidencia, alternativas y riesgos relevantes; ninguna afirmación nueva carece de origen o se presenta como hecho sin respaldo en el material indicado.

- [ ] PASS

## 5. Continuidad de sesión

**Criterio:** dos consultas dentro de la misma curación conservan continuidad reutilizando el mismo identificador de sesión.

**Precondición:** ejecutar F1 y F2.

**Pasos:** delegar una segunda consulta con el mismo `sessionId` (`qa-curation-1`) y conservar su `queryId`; verificar que ambas consultas pertenecen a la misma sesión.

**Comprobación:**

```bash
QUERY_ID_2=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/qa-sintesis/synthesis/queries" -H 'content-type: application/json' -d '{"sessionId":"qa-curation-1","actor":"director","recipient":"DIRECTOR","query":"¿Qué faltaría para validar el enfoque?","context":[]}' | jq -r '.queryId')
curl -fsS "http://localhost:3000/api/v1/opportunities/qa-sintesis/synthesis/sessions/qa-curation-1/queries/$QUERY_ID" > /dev/null
curl -fsS "http://localhost:3000/api/v1/opportunities/qa-sintesis/synthesis/sessions/qa-curation-1/queries/$QUERY_ID_2" | jq -e '.queryId == $QUERY_ID_2'
```

**Resultado binario:** ambas consultas responden 200 bajo la misma sesión `qa-curation-1` (si una consulta perteneciera a otra sesión, la API rechazaría el par sessionId/queryId con error 4xx). El Director reutiliza el identificador de la curación sin crear sesiones nuevas por consulta.

- [ ] PASS

## 6. Persistencia y retención de la última versión

**Criterios:** la síntesis producida queda registrada y recuperable; con retención en default queda solo la última versión accesible.

**Precondición:** ejecutar F1, F2 y F3.

**Pasos:** (a) leer el resultado persistido; (b) repetir el POST de F3 con una `conclusion` distinta y releer.

**Comprobación:**

```bash
curl -fsS "http://localhost:3000/api/v1/opportunities/qa-sintesis/synthesis/sessions/qa-curation-1/queries/$QUERY_ID" | jq -e '.conclusion == "La reducción está sostenida por registros propios."'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/qa-sintesis/synthesis/queries/$QUERY_ID/result" -H 'content-type: application/json' -d '{"sessionId":"qa-curation-1","conclusion":"Versión re-trabajada: registros propios más cruce con el resto del material.","relevantEvidence":[],"uncertainties":[],"recommendation":"Avanzar."}'
curl -fsS "http://localhost:3000/api/v1/opportunities/qa-sintesis/synthesis/sessions/qa-curation-1/queries/$QUERY_ID" | jq -e '.conclusion == "Versión re-trabajada: registros propios más cruce con el resto del material."'
```

**Resultado binario:** el GET inicial devuelve lo escrito en F3; tras el segundo POST, el GET devuelve solo la versión re-trabajada (conclusión nueva) y nunca la anterior.

- [ ] PASS

## 7. Citación de fuentes según criterio editorial

**Criterio:** dato primario/autoritativo/citable/polémico/reciente incluye origen; dato trivial lo omite.

**Precondición:** ejecutar F1 y F2 (el fixture contiene una cifra reciente y polémica: la reducción de 40 a 8 minutos).

**Pasos:** en la conversación con el Director, delegar una consulta que cruce el dato medible con un dato trivial del material (por ejemplo, qué es una automatización de diagnóstico).

**Resultado binario:** la afirmación sobre la reducción 40→8 minutos aparece con origen concreto (por ejemplo `[título: locator]` apuntando al registro de la nota), y el dato trivial aparece sin fuente; la sección Fuentes (o la traza en Evidencia relevante) no es una bibliografía global.

- [ ] PASS

## 8. Idioma de salida

**Criterio:** research original en idioma extranjero → entrega en el idioma configurado (español por defecto).

**Precondición:** crear oportunidad con nota en inglés y delegar consulta sobre ella.

```bash
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d '{"opportunityId":"qa-en"}'
curl -fsS -X POST http://localhost:3000/api/v1/opportunities/qa-en/curation/proposals -H 'content-type: application/json' -d '{"originalNote":"Cut automated failure diagnostics from 40 to 8 minutes across three projects.","evidence":"Own records: 40 min before, 8 min after.","centralApproach":"Show the diagnostic method and its measurable reduction."}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/qa-en/synthesis/sessions" -H 'content-type: application/json' -d '{"sessionId":"qa-en-1","actor":"director","recipient":"DIRECTOR"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/qa-en/synthesis/queries" -H 'content-type: application/json' -d '{"sessionId":"qa-en-1","actor":"director","recipient":"DIRECTOR","query":"Summarize the evidence and the decision gap.","context":[]}'
```

**Pasos:** delegar la consulta sobre `qa-en` y revisar la síntesis resultante.

**Resultado binario:** la síntesis se entrega en español, conservando los términos técnicos y nombres propios en inglés cuando corresponda (`automation`, `diagnostics`); si una cita textual se traduce, aparece marcada como traducción propia.

- [ ] PASS

## 9. Aislamiento

**Criterios:** no es conversable directamente; sus resultados solo llegan dentro de la conversación del Director.

**Precondición:** setup común; ninguna adicional.

**Pasos:** (a) intentar abrir una conversación directa con `cliplab-sintesis` (no aparece en el selector de agentes); (b) completar el escenario 2 y verificar el único canal de salida.

**Resultado binario:** no existe conversación directa posible con ella; la síntesis aparece únicamente en la conversación del Director y queda recuperable por API; no hay ningún canal en el que `cliplab-sintesis` entregue resultados al usuario directamente.

- [ ] PASS

## 10. Trazabilidad del prompt contra las fuentes base

**Criterio:** cada bloque instructivo de `agents/sintesis.md` traza a una pieza identificada con su proveniencia (adaptación completa / extracción de principios / parcial ~60%) o a una decisión D-01…D-08 del plan; cero líneas inventadas desde cero.

**Precondición:** Engram con el artifact `ca/ca-agente-mano-derecha/artifact/investigacion` (#4348) y el plan `ca/ca-agente-mano-derecha/artifact/plan` (#4352) recuperable.

**Pasos:** auditar `agents/sintesis.md` sección por sección contra #4348 y las decisiones D-01…D-08, siguiendo el mapa de derivación del plan.

**Resultado binario:** cada bloque instructivo del prompt corresponde a un bloque verbatim de #4348, a un principio extraído (piezas 6–13) o a un texto cerrado por decisión D-01…D-08 del plan; no queda ningún bloque o línea sin proveniencia. La auditoría se registra en el reporte del constructor con el detalle bloque por bloque.

- [ ] PASS

---

## Cierre

El CA pasa QA conversacional únicamente con **10/10 casillas marcadas**. Una casilla fallida conserva el output de OpenCode y los responses de curl asociados; no se interpreta como éxito parcial.