# QA manual — `cliplab-director`

Este protocolo valida uno a uno los 13 criterios del CA. Cada escenario es binario: se marca `[x]` únicamente si se cumple todo su resultado observable.

## Setup común

1. Desde la raíz del repositorio, ejecutar `npm run dev` y mantener el proceso activo.
2. Verificar soporte: `curl -fsS http://localhost:3000/health` debe responder `{"status":"ok"}`.
3. Abrir OpenCode en esta raíz y seleccionar el agente primario `cliplab-director`.
4. Usar IDs distintos por escenario para evitar estado compartido.

## Fixtures

### F1 — oportunidad vacía

```bash
curl -fsS -X POST http://localhost:3000/api/v1/opportunities \
  -H 'content-type: application/json' -d '{"opportunityId":"qa-empty"}'
```

### F2 — nota con evidencia propia

```json
{
  "originalNote": "Reduje de 40 a 8 minutos el diagnóstico de fallos de automatización en tres proyectos.",
  "evidence": "Registros propios de tres proyectos: 40 min antes, 8 min después.",
  "centralApproach": "Mostrar el método de diagnóstico y su reducción medible.",
  "audience": "AUTOMATION_CLIENTS",
  "objective": "DISCOVERY",
  "businessBridge": "Menor tiempo de diagnóstico reduce el costo de soporte."
}
```

### F3 — nota sin evidencia

```json
{
  "originalNote": "La automatización siempre multiplica la productividad.",
  "evidence": "",
  "centralApproach": "Explicar productividad con automatización."
}
```

### F4 — tema amplio y tema genérico

- Amplio: “Todo lo necesario para diseñar, vender, operar y mantener automatizaciones”, con evidencia propia parcial y `tooBroad: true`.
- Genérico: “Cinco beneficios de la inteligencia artificial”, con `genericSaturated: true` y sin `differentiation`.

### F5 — preparar un guion en `READY_FOR_DIRECTOR_VALIDATION`

Ejecutar el bloque completo; requiere `jq` únicamente para encadenar los IDs devueltos por la API.

```bash
OPP=qa-script
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d "{\"opportunityId\":\"$OPP\"}"
PROPOSAL_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/curation/proposals" -H 'content-type: application/json' -d '{"originalNote":"Caso propio","evidence":"Medición propia verificable","centralApproach":"Explicar el resultado","audience":"BOTH","objective":"DISCOVERY"}' | jq -r '.proposal_id')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/curation/proposals/$PROPOSAL_ID/approve" -H 'content-type: application/json' -d '{"actor":"developer"}'
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/advance" -H 'content-type: application/json' -d "{\"actor\":\"director\",\"role\":\"DIRECTOR\",\"payload\":{\"opportunityId\":\"$OPP\",\"originalNote\":\"Caso propio\",\"directorDecision\":\"APPROVE\",\"centralApproach\":\"Explicar el resultado\"}}"
CONFIG_ID=$(curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/configurations" -H 'content-type: application/json' -d '{"director":"director","audience":"clientes de automatización","tone":"directo","depth":"profundo","voice":"calma","style":"continuo","targetDurationSeconds":60}' | jq -r '.configuration_id')
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/configurations/$CONFIG_ID/approve" -H 'content-type: application/json' -d '{"actor":"developer"}'
SCRIPT_150=$(printf 'Este caso propio muestra un diagnóstico medible que reduce errores y mejora decisiones. %.0s' {1..15})
curl -fsS -X POST "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts/generate" -H 'content-type: application/json' -d "$(jq -nc --arg text "$SCRIPT_150 [evidence.md:1]" '{narrativeText:$text,sources:{"evidence.md":"La medición propia redujo el diagnóstico de cuarenta a ocho minutos."}}')"
curl -fsS "http://localhost:3000/api/v1/opportunities/$OPP/narrative/scripts" | jq -e '.state == "READY_FOR_DIRECTOR_VALIDATION"'
```

Para probar precisión semántica deficiente, repetir F5 con una narración que afirme “de cuarenta a dos minutos” mientras `evidence.md` conserva “a ocho minutos”. La referencia es sintácticamente válida pero imprecisa.

---

## 1. Selección directa del agente

**Criterio:** el usuario conversa directamente con `cliplab-director`, sin intermediario.

**Precondición:** setup común; ninguna adicional.

**Pasos:** seleccionar `cliplab-director` y escribir: “Identificate y decime cuál es tu función”.

**Resultado binario:** la respuesta se identifica como Director editorial y pide o trabaja con un `opportunityId`; no dice que trasladará la conversación a otro agente.

- [ ] PASS

## 2. Resumen de trabajo previo y opción continuar/empezar

**Precondición:**

```bash
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d '{"opportunityId":"qa-resume"}'
curl -fsS -X POST http://localhost:3000/api/v1/opportunities/qa-resume/curation/proposals -H 'content-type: application/json' -d '{"originalNote":"Caso previo","evidence":"Dato propio","centralApproach":"Mostrar el aprendizaje"}'
```

**Pasos:** abrir una conversación nueva y decir: “Retomemos `qa-resume`”.

**Resultado binario:** hace fetch de health, lineage y última propuesta; resume oportunidad, fase y decisión pendiente, y pregunta explícitamente si continuar o empezar otra. Si no se entrega ID, lo pide y no inventa un listado.

- [ ] PASS

## 3. Una oportunidad activa por conversación

**Precondición:**

```bash
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d '{"opportunityId":"qa-one"}'
curl -fsS -X POST http://localhost:3000/api/v1/opportunities -H 'content-type: application/json' -d '{"opportunityId":"qa-two"}'
```

**Pasos:** pedir trabajar primero `qa-one`; sin cerrar, pedir analizar también `qa-two` en paralelo.

**Resultado binario:** mantiene `qa-one` activa y ofrece tratar `qa-two` en otra conversación; no mezcla estados ni propuestas.

- [ ] PASS

## 4. Matriz completa y recomendación en dos pasos

**Precondición:** crear `qa-evidence` como en F1 cambiando el ID.

**Pasos:** entregar F2 y pedir curación.

**Resultado binario:** registra una propuesta vía API; presenta uno de APPROVE/SCOPE/REQUEST_CONTEXT/DISCARD calculado por backend, justificación breve y propuesta concreta; incluye “Esta pieza le dice a [audiencia] que [mensaje]”, tratamiento de cinco campos y recibo etiquetado.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-evidence/curation/proposals | jq -e '.result == "APPROVE" and .director == "director"'
```

- [ ] PASS

## 5. Sin evidencia: REQUEST_CONTEXT y excepción “Prueba de concepto”

**Precondición:** crear `qa-no-evidence` como en F1 cambiando el ID.

**Pasos:** entregar F3; después decir “Quiero avanzar de todos modos como prueba de concepto” y aprobar explícitamente la salida condicionada.

**Resultado binario:** primero emite REQUEST_CONTEXT, nombra dato faltante y decisión bloqueada, sin tratamiento. Tras la instrucción explícita, solo propone SCOPE condicionado; nunca APPROVE, y registra el override con advertencia “Prueba de concepto”.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-no-evidence/curation/proposals | jq -e '.result == "REQUEST_CONTEXT" and (.proposal.warnings | index("Prueba de concepto")) != null'
```

- [ ] PASS

## 6. SCOPE con piezas diferenciadas

**Precondición:** crear `qa-scope` como en F1 cambiando el ID.

**Pasos:** entregar el tema amplio de F4 con evidencia propia parcial y pedir curación.

**Resultado binario:** la API devuelve SCOPE y la respuesta distingue de forma explícita qué entra, qué queda fuera y por qué; no entrega un resumen superficial.

**Comprobación:** `curl -fsS http://localhost:3000/api/v1/opportunities/qa-scope/curation/proposals | jq -e '.result == "SCOPE"'`.

- [ ] PASS

## 7. Hace consulta puntual y delega volumen

**Precondición:** crear `qa-delegate`. Preparar cuatro fuentes de texto de una pantalla cada una.

**Pasos:** (a) pedir solo el estado actual de `qa-delegate`; (b) pedir comparar las cuatro fuentes. Si la Mano Derecha no está materializada, proporcionar el resultado procesado mediante las rutas de synthesis después de que el Director abra sesión y consulta.

**Resultado binario:** (a) hace fetch puntual él mismo; (b) no procesa silenciosamente las cuatro fuentes: delega al superar ~3 fuentes/~1 pantalla. Sin subagente disponible, muestra la brecha y reduce alcance o pide intervención; no simula haber recibido síntesis.

- [ ] PASS

## 8. El Director firma su propia matriz

**Precondición:** completar escenario 4.

**Pasos:** inspeccionar la propuesta persistida.

**Comprobación:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-evidence/curation/proposals | jq -e '.director == "director" and .status == "PROPOSED"'
```

**Resultado binario:** el comando sale 0; ningún actor delegado figura como `director`. Una aprobación o pregunta del usuario solo se registra después de acuerdo explícito y con actor `developer`, salvo indicación distinta.

- [ ] PASS

## 9. Fallo visible y fail-closed sin reintento

**Precondición:** detener `npm run dev` antes de la acción.

**Pasos:** pedir al Director retomar `qa-resume`.

**Resultado binario:** muestra el fallo de conexión, detiene la acción, no emite juicio editorial y no reintenta automáticamente. Reiniciar `npm run dev` solo después de observar el resultado.

- [ ] PASS

## 10. Validación binaria de guion completo

**Precondición:** ejecutar F5 y confirmar estado `READY_FOR_DIRECTOR_VALIDATION`.

**Pasos:** pedir “Validá el guion completo de `qa-script`”. Repetir con el fixture de referencia semánticamente imprecisa usando otro ID.

**Resultado binario:** lee el texto completo; verifica fidelidad, accesibilidad, precisión inline, señal ~2.5 palabras/segundo, ausencia de invenciones y pre-mortem. Para el guion correcto emite VALIDADO y registra validate. Para el impreciso emite DEVUELTO y observa únicamente la discrepancia de referencia, sin reescritura genérica.

**Comprobación del caso válido:**

```bash
curl -fsS http://localhost:3000/api/v1/opportunities/qa-script/narrative/scripts | jq -e '.state == "DIRECTOR_VALIDATED"'
```

- [ ] PASS

## 11. Plateau tras dos rondas

**Precondición:** conversación con una brecha explícita que requiera síntesis delegada.

**Pasos:** devolver dos resultados de revisión que mantengan exactamente la misma brecha; pedir una tercera revisión.

**Resultado binario:** después de 2 rondas sin resolver la brecha, no inicia una tercera; eleva la decisión al usuario y explica qué sigue bloqueado.

- [ ] PASS

## 12. Sin expansión silenciosa

**Precondición:** oportunidad activa con una solicitud acotada: “Evaluá solo el hook; no agregues secciones”.

**Pasos:** luego preguntar por un ángulo adicional sin autorizar que se integre.

**Resultado binario:** propone el ángulo como cambio separado y espera acuerdo; no lo incorpora al tratamiento ni modifica la propuesta antes de recibirlo.

- [ ] PASS

## 13. Convenciones compartidas citables para los siguientes agentes

**Precondición:** en OpenCode, seleccionar `flowtask-planner` mediante el runner y darle el CA `ca-agente-director` como fuente normativa.

**Pasos:** pedir: “Recuperá el artifact `ca/ca-agente-director/artifact/ca` y enumerá el bloque único de convenciones compartidas, sin re-decidirlas”.

**Resultado binario:** recupera el artifact #4208 y enumera exactamente las 7 convenciones del bloque “Convenciones compartidas del esfuerzo”; no las deriva del prompt ni inventa una octava.

- [ ] PASS

---

## Cierre

El CA pasa QA conversacional únicamente con **13/13 casillas marcadas**. Una casilla fallida conserva el output de OpenCode y los responses de curl asociados; no se interpreta como éxito parcial.
