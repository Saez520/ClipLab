# Pipeline de agentes para creación de contenido (FlowTask / LinkedIn-Reels) — v2

**Fecha de corte:** 2026-08-22.  
**Fuente de verdad:** memorias Engram del proyecto `cliplab`. El archivo v1 se usó únicamente para conservar la estructura y el formato; no se usa como fuente de estado actual.

El pipeline separa tres capas: usuario, agentes conversacionales y una API de orquestación determinística. El usuario conversa con el Director; los agentes se relacionan con la API para estados y handoffs. Research externo quedó fuera del pipeline; la síntesis de contexto reemplaza la investigación interna del flujo (#3626, #3662).

---

## 1. Alcance: 3 fases, esta cadena cubre solo la Fase 2 y 3

1. **Research** — fase externa. Las notas pueden provenir de research o de la experiencia de construcción; no hay evidencia en Engram de un agente de Research perteneciente a esta cadena (#3626, #3597).
2. **Curación creativa** — qué va, qué no, cómo se presenta. → Cubierta por `ca-curador-director`, implementado y mergeado (#3597, #3860).
3. **Producción del video** — narración, storyboard y producción. → Narración implementada y mergeada; storyboard y producción están definidos, pero no hay evidencia de implementación/merge (#3598, #3936, #3600, #3601).

La orquestación es una capa transversal de control determinístico, no un agente con LLM. El CA correspondiente está implementado y validado, pero su merge no está registrado explícitamente en las memorias consultadas (#3602, #3652, #3664).

---

## 2. Flujo definido (ASCII)

```
                 [ Usuario + Research externo ]
                               │
                     nota / oportunidad de contenido
                               │
                               ▼
                 ┌──────────────────────────┐
                 │        DIRECTOR          │  IMPLEMENTADO + MERGEADO
                 │  (curación y juicio)      │
                 │                           │
                 │  - evalúa evidencia       │
                 │  - delimita enfoque        │
                 │  - define audiencia        │
                 │  - fija objetivo           │
                 │  - advierte brechas        │
                 │  - propone tratamiento     │
                 │  - propone hook si aplica  │
                 └──────────┬────────────────┘
                            │ delega recuperación de contexto
                            ▼
                 ┌──────────────────────────┐
                 │   MANO DERECHA / SÍNTESIS │  IMPLEMENTADA + MERGEADA
                 │   (subagente del Director) │
                 │                           │
                 │  - reutiliza la sesión     │
                 │  - prioriza contexto actual│
                 │  - sintetiza para decidir   │
                 │  - declara faltantes       │
                 │  - recomienda sin decidir   │
                 └──────────┬────────────────┘
                            │
                       loop de curación
                            │
                            ▼
                 ── propuesta del Director ──
                 ── aprobación explícita del usuario ──
                            │
                            ▼
                 ┌──────────────────────────┐
                 │    GUION NARRADO          │  IMPLEMENTADO + MERGEADO
                 │    (narración accesible)  │
                 │                           │
                 │  - texto continuo         │
                 │  - referencias inline      │
                 │  - sin decisiones visuales │
                 └──────────┬────────────────┘
                            │ handoff simple; Director valida antes
                            ▼
                 ┌──────────────────────────┐
                 │   STORYBOARD / ESTRUCTURA │  SOLO DEFINIDO
                 │  - segmentos y duración   │
                 │  - ritmo y posiciones     │
                 │  - correspondencia audio  │
                 │    y visual               │
                 └──────────┬────────────────┘
                            ▼
                 ┌──────────────────────────┐
                 │   EDITOR / HYPERFRAMES    │  SOLO DEFINIDO
                 │  - render sincronizado    │
                 │  - no reabre decisiones    │
                 └──────────┬────────────────┘
                            ▼
                       VIDEO FINAL
```

La orquestación registra el recorrido `NOTE → SCRIPT → STORYBOARD → RENDER → FINAL`, conserva el identificador de la oportunidad y exige autorización explícita en cada transición. Ante fallo o revisión, deja el estado visible y no reintenta, reanuda ni avanza automáticamente (#3602, #3637, #3651).

La frontera narrativa es estricta: el storyboard consume el producto del narrador, interpreta sus referencias y decide qué, cómo y cuándo mostrar. El narrador no crea un agente técnico ni prescribe cues, visuales o sincronización (#3598, #3620, #3936).

---

## 3. Decisiones tomadas (con el porqué)

| Decisión | Resuelto como | Por qué / evidencia |
|---|---|---|
| ¿Cómo se coordina el pipeline? | **MVP lineal con detención visible, sin recuperación automática y con autorización explícita entre etapas.** | Prioriza previsibilidad, trazabilidad y control humano; la recuperación automática queda fuera del MVP (#3602, #3637, #3651). |
| ¿La orquestación es un agente? | **No.** Es control de flujo determinístico separado del juicio creativo. | La coordinación de estados y handoffs no debe emitir juicio editorial (#3602, #3626, #3662). |
| ¿Existe un descubridor separado? | **No.** El Director cura y puede delegar recuperación de contexto a la mano derecha. | No se agregan agentes separados cuando la responsabilidad queda cubierta por curación o síntesis (#3597, #3599). |
| ¿Existe un validador editorial separado? | **No.** La validación editorial queda en el Director. | El Director conserva la decisión editorial y el usuario autoriza el avance; la mano derecha recomienda, pero no decide (#3597, #3599). |
| ¿Qué hace la mano derecha? | **Recupera y sintetiza contexto orientado a decisión solo para el Director.** | Evita releer o reconstruir la historia sin transferir la decisión editorial al subagente (#3599, #3619). |
| ¿Cómo mantiene continuidad? | **Reutiliza el mismo identificador de sesión durante la curación.** | Permite consultas repetidas y actualizaciones dentro de la misma oportunidad (#3599, #3743, #3769). |
| ¿Qué formato tiene la síntesis? | **Conclusión, evidencia relevante, incertidumbres o faltantes, recomendación, alternativas/riesgos cuando correspondan y fuentes cuando correspondan.** | Mantiene foco decisional, explicita incertidumbre y permite ampliar sin inventar (#3599, #3619). |
| ¿Cuándo se incluyen fuentes en la síntesis? | Solo si son primarias/autoritativas, el dato debe citarse o es polémico/reciente. | Es el criterio explícito para equilibrar trazabilidad y brevedad (#3599). |
| ¿Cómo decide el Director si una nota avanza? | Matriz visible **APPROVE / SCOPE / REQUEST_CONTEXT / DISCARD**, con justificación y propuesta en dos pasos. | La aptitud exige evidencia propia, enfoque delimitado y audiencia/objetivo identificables; el usuario aprueba explícitamente el avance (#3597, #3840, #3860). |
| ¿Qué ocurre sin evidencia propia? | Se pide contexto; si el usuario decide avanzar, se advierte **“Prueba de concepto”**. | No se inventa experiencia ni se presenta una afirmación no probada como evidencia propia (#3597, #3618). |
| ¿Cuál es el formato de contenido por defecto? | **Doble canal sincronizado**, salvo canal único con justificación editorial visible. | La narración mantiene accesibilidad y el visual conserva precisión técnica (#3597, #3618). |
| ¿Dónde se decide la duración? | El Director puede dar una duración orientativa; el storyboard define la duración final. | La curación no fija segundos y la planificación visual decide el timing real (#3597, #3598). |
| ¿Guion técnico separado? | **No.** Existe un único CA de guion narrado accesible; no se agrega agente técnico. | El narrador no debe invadir la responsabilidad visual del storyboard (#3598, #3620, #3936). |
| ¿Cómo se configura la narración? | El Director propone voz, tono y estilo por oportunidad; el usuario los aprueba antes de generar. | Conserva adaptación editorial y control explícito del usuario (#3598, #3936). |
| ¿Qué valida el Director? | Valida el guion final antes del handoff al storyboard. | Protege la fidelidad al enfoque curado y aprobado (#3598, #3620). |
| ¿Cómo se expresan las referencias técnicas? | Inline, con `[ruta/relativa/archivo.ts:12-15]` o `[ruta/archivo.md:sección]`. | El handoff se mantiene simple y legible; las referencias son metadatos, no un contrato complejo (#3598, #3620). |
| ¿Qué ocurre ante un vacío material? | El guion queda bloqueado, vuelve al Director y no se completa con invenciones. | La fidelidad al enfoque aprobado prevalece sobre fabricar contenido faltante (#3598, #3936). |
| ¿Qué consume el storyboard? | El texto narrado y sus referencias inline. | El storyboard interpreta las referencias bajo su propia responsabilidad; el narrador no entrega prescripciones visuales (#3598, #3620, #3936). |
| ¿Qué rol tienen los hooks? | Son complementos de bajo costo para reducir una brecha conceptual; no reemplazan ni desplazan automáticamente la pieza principal. | Se separan del flujo principal para no expandirlo antes de validarlo (#3597, #3603). |

---

## 4. Preguntas pendientes (definir ANTES de construir)

Las siguientes preguntas no deben presentarse como decisiones cerradas: permanecen en los CAs que todavía están solo definidos.

1. **Storyboard — aceptación previa al render.** Falta definir quién valida que la correspondencia audio-visual y el ritmo sean aptos para producir (#3600).

2. **Storyboard — restricciones de formato.** Faltan duración, audiencia, idioma y formato de publicación que condicionan segmentos, densidad visual y ritmo (#3600).

3. **Storyboard → producción.** Falta definir el payload mínimo del storyboard aprobado para que producción no deba reinterpretarlo (#3600).

4. **Producción — puerta de entrada al render.** Falta definir quién confirma que el storyboard está aprobado para enviarlo a Hyperframes (#3601).

5. **Producción — fallos de render.** Falta definir el detalle visible al operador, la cantidad de reintentos y cuándo volver al storyboard (#3601). La orquestación general no reintenta automáticamente en su MVP (#3602, #3651).

6. **Producción — límites de capacidad.** Faltan duración por video, volumen concurrente y formatos de salida (#3601).

7. **Hooks — flujo de producción e inclusión.** Falta decidir si usan el dual-channel completo, una versión abreviada u otro recorrido, y si entran en la primera entrega (#3603).

8. **Hooks — reglas editoriales.** Faltan duración, audiencia, idioma y quién aprueba que la brecha conceptual haya sido resuelta (#3603).

9. **Backlog y artefactos completos.** El backlog queda fuera del CA de síntesis; tampoco está cerrada la ubicación de artefactos completos frente a contratos/handoffs (#3599, #3662).

10. **Agentes de OpenCode.** Los agentes del pipeline aún no están construidos. Existe un CA futuro para crearlos al final, después de definir los demás CAs; todavía no hay slug ni implementación registrada (#3768, #3769).

11. **Merge de orquestación.** Hay evidencia de implementación, commit y validación aprobada, pero no de un squash-merge o merge explícito; por eso el estado se informa como “implementado sin merge registrado” (#3652, #3664, #3663).

12. **GAPs menores de validación.** Orquestación conserva tres mejoras opcionales no bloqueantes; curador conserva dos desvíos menores aceptados. No modifican las decisiones operativas del pipeline (#3651, #3855). La síntesis tuvo mejoras M1-M5 aprobadas en un hotfix; quedaron dos sugerencias de revisión no bloqueantes (#3788).

---

## 5. Con qué seguir antes de construir

- Construir y cerrar `ca-storyboard-dual-channel`, resolviendo aceptación, restricciones de formato y handoff hacia producción (#3600, #3631).
- Construir y cerrar `ca-produccion-video-sincronizado`, resolviendo la puerta de render, fallos y límites de capacidad (#3601, #3631).
- Construir y cerrar `ca-hooks-introductorios` después de validar el flujo principal, resolviendo su recorrido y reglas editoriales (#3603, #3631).
- Crear al final el CA dedicado a materializar los agentes de OpenCode: Director, síntesis, guion, storyboard y editor, consumiendo los contratos/API ya definidos (#3768).
- Mantener separadas las tres capas: conversación usuario↔agente, estados/handoffs agente↔API y artefactos completos cuya ubicación todavía está abierta (#3662).

La parte ya implementada del flujo es: orquestación determinística, síntesis de contexto, curación del Director y guion narrado. La parte storyboard, producción y materialización de agentes permanece pendiente según la evidencia disponible (#3652, #3747, #3855, #3936, #3768).

---

## 6. Estado de CAs a 2026-08-22

| CA | Estado clasificado | Evidencia Engram | Qué actualiza del pipeline |
|---|---|---|---|
| `ca-orquestacion-pipeline-contenido` (antes CA-006) | **Implementado sin merge registrado** | CA aprobado 96/100 y commit confirmado; no aparece un merge explícito (#3652, #3664, #3663). | Estados lineales, detención visible, autorizaciones por transición, handoffs trazables y separación de la coordinación determinística (#3602, #3651). |
| `ca-sintesis-contexto` (antes CA-002) | **Implementado + mergeado** | APPROVED 93/100; implementación cerrada y commit/hotfix publicado en `origin/main` (#3747, #3743, #3788, #3774). | Mano derecha solo para el Director, continuidad por sesión, síntesis orientada a decisión, faltantes explícitos y fuentes condicionadas (#3599, #3619). |
| `ca-curador-director` (antes CA-001/CA-003 en registros históricos) | **Implementado + mergeado** | APPROVED 95/100; reconstrucción mergeada a `main` en `8df2bbe` (#3855, #3860). | Matriz editorial, doble canal por defecto, alcance unilateral advertido, “Prueba de concepto”, autorización del usuario y continuidad de curación (#3597, #3618, #3840). |
| `ca-guion-narrado` (antes CA-003) | **Implementado + mergeado** | APPROVED 95/100 y squash-merge a `main` en `5df9ba0` (#3936, #3927). | Narración accesible, referencias inline, configuración aprobada por usuario, validación final del Director, bloqueo por vacíos y frontera estricta con storyboard (#3598, #3620). |
| `ca-storyboard-dual-channel` (antes CA-004) | **Solo definido** | Artifact formalizado, con decisiones pendientes y sin evidencia de construcción/validación/merge (#3600, #3621, #3631). | Define segmentos, duración, ritmo, posiciones y correspondencia audio-visual; todavía no es una operación implementada (#3600). |
| `ca-produccion-video-sincronizado` (antes CA-005) | **Solo definido** | Artifact formalizado, con decisiones pendientes y sin evidencia de construcción/validación/merge (#3601, #3622, #3631). | Define producción desde storyboard aprobado hacia Hyperframes, manejo de fallo y asociación al storyboard; todavía no es una operación implementada (#3601). |
| `ca-hooks-introductorios` (antes CA-007) | **Solo definido** | Artifact formalizado, con decisiones pendientes y sin evidencia de construcción/validación/merge (#3603, #3624, #3631). | Define hooks como complemento de una pieza principal; su producción, inclusión y reglas siguen abiertas (#3603). |
| CA futuro de creación de agentes de OpenCode | **Solo definido / pendiente** | Decisión explícita de postergarlo al final; agentes aún no construidos (#3768, #3769). | Materializaría Director, síntesis, guion, storyboard y editor; no debe confundirse con los CAs de soporte ya implementados (#3768, #3662). |

No se encontró en las memorias consultadas un CA del pipeline clasificado como rechazado u obsoleto. Las definiciones de guion narrado sí reemplazan una versión anterior del mismo CA, pero el CA vigente está marcado `complete` (#3598, #3620, #3936).

---

## 7. Fuentes de trazabilidad

Las referencias inline del documento apuntan a observaciones Engram del proyecto `cliplab`:

| IDs | Uso en este documento |
|---|---|
| #3597, #3618, #3840, #3855, #3860 | Definición, decisiones, implementación y merge del Director. |
| #3598, #3620, #3909, #3927, #3936 | Definición final, frontera y cierre mergeado del guion narrado. |
| #3599, #3619, #3692, #3743, #3747, #3769, #3788 | Alcance, decisiones, implementación, validación y publicación de síntesis. |
| #3600, #3621 | Definición y pendientes del storyboard. |
| #3601, #3622 | Definición y pendientes de producción con Hyperframes. |
| #3602, #3623, #3637, #3651, #3652, #3663, #3664 | Definición, decisiones, validación y estado de orquestación. |
| #3603, #3624 | Definición y pendientes de hooks. |
| #3588, #3631, #3626, #3662 | Inventario, trazabilidad, orden y arquitectura general de los CAs. |
| #3768 | CA futuro para creación de agentes en OpenCode. |
| #3941 | Alcance de esta actualización documental y fecha de corte de la tarea. |

---

## 8. Memoria — convenciones

Los 5 agentes de contenido (Director, Síntesis, Guionista, Storyboard y Editor) quedaron materializados con sus definiciones vigentes intactas (prompts en `agents/*.md`, registro en `opencode.json`). Sobre esa capa de definición se agregó una **capa de memoria** vía la skill portable `skill/convenciones-memoria-agentes-contenido/SKILL.md` en la raíz versionada (#4187: "solo agrega capa de memoria encima").

Reglas mínimas (acordadas en #4187):

1. **Namespaces propios** — cada rol guarda en `content-agents/{rol}/*`.
2. **Un dueño por namespace** — el rol dueño escribe; los demás solo leen.
3. **Proponer antes de guardar** — escribir en namespace ajeno o nuevo requiere propuesta previa y confirmación.
4. **No modificar definiciones vigentes** — la memoria no cambia los prompts ni el registro de agentes.

La continuidad operativa sigue siendo el soporte determinístico (API) de cada rol (convención 7, #4190); la memoria es capa complementaria de convenciones, decisiones y descubrimientos. Los 5 prompts referencian la skill en su sección de estado/continuidad — la integración fue aditiva (1 línea por agente), sin alterar ninguna definición vigente.
