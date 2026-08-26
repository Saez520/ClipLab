# Pipeline de agentes para creación de contenido (FlowTask / LinkedIn-Reels)

> **Nota (2026-08-26, hotfix HF-documentacion-proyecto):** este archivo es el diseño conversacional original (v1). La fuente de estado actual del pipeline es `docs/pipeline-agentes-contenido-v2.md` (v2): refleja los CAs implementados y mergeados (incluidos storyboard dual-channel y producción sincronizada) y los 5 agentes de contenido materializados en `agents/*.md`. La v1 se conserva únicamente como histórico de diseño.

Contexto: definición del pipeline multi-agente para producir contenido técnico (arquitectura de agentes, FlowTask) en formato dual-channel (audio narra accesible, visual muestra lo mismo con precisión técnica, en simultáneo, ejecutado vía Hyperframes).

Este documento cierra la fase de diseño conversacional. Objetivo: dejar todo aclarado antes de mandarlo a construcción.

---

## 1. Alcance: 3 fases, esta cadena cubre solo la Fase 2 y 3

1. **Research** — agente propio, ya existe, **no forma parte de este diseño**.
2. **Curación creativa** — qué va, qué no, cómo se presenta. → Objeto de este documento.
3. **Producción del video** — guion, storyboard, edición. → Objeto de este documento.

---

## 2. Flujo definido (ASCII)

```
                    [ Vos + Research (fase 1, externo) ]
                                  │
                     nota suelta: "de esto puede salir algo"
                     (resumen tuyo, NO el research completo)
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │        DIRECTOR          │◄──────┐
                    │  (juicio, mantiene hilo)  │       │
                    │                            │       │ contexto
                    │  - descarta                │       │ acumulado
                    │  - acota / desarrolla       │       │ de la sesión
                    │  - explica (si falta base)  │       │ de curación
                    │  - genera hook de bajo costo│       │ (mismo task_id)
                    │  - detecta gaps técnicos     │       │
                    └──────────┬────────────────┘       │
                               │ delega búsqueda          │
                               ▼                          │
                    ┌──────────────────────────┐          │
                    │   MANO DERECHA (subagente)│──────────┘
                    │  busca (backlog interno    │
                    │  o externo) y SINTETIZA     │
                    │  antes de devolver:         │
                    │  - qué necesita saber        │
                    │    (no el cómo/de dónde,     │
                    │     salvo que sea útil        │◄── [PENDIENTE, ver §4]
                    │     — criterio sin definir)   │
                    └──────────────────────────┘
                               │
                    (loop de vuelta al Director
                     cuantas veces haga falta)
                               │
                               ▼
                    ── Director da luz verde ──
                               │
                               ▼
                    ┌──────────────────────────┐
                    │        GUIONISTA          │
                    │  narrativa + guion de audio│
                    │  (accesible)               │
                    └──────────┬────────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │   STORYBOARD / ESTRUCTURA │
                    │  duración, qué va en       │
                    │  pantalla, posiciones,      │
                    │  ritmo, mapeo precisión-    │
                    │  visual vs accesibilidad-   │
                    │  audio por segmento         │
                    └──────────┬────────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │   EDITOR (Hyperframes)     │
                    │  ejecuta render sincronizado│
                    └──────────┬────────────────┘
                               ▼
                          VIDEO FINAL
```

**Orquestación** (handoffs, reintentos, estado del pipeline) es lógica de código separada del juicio de los agentes — no es un agente con LLM, es control de flujo determinístico. (Aclarado: esto NO existe todavía en FlowTask, es una decisión nueva para este pipeline, no una reutilización de algo ya construido.)

---

## 3. Decisiones tomadas (con el porqué)

| Decisión | Resuelto como | Por qué |
|---|---|---|
| ¿Guion primero o estructura primero? | **Curación primero**, luego guion, luego storyboard | Ninguno de los repos open source investigados (agentcut, Open-AI-Micro-Drama-Generator) hace esto — todos asumen que ya sabés qué historia contar. Tu diferenciador (profundidad técnica) requiere un paso de curación explícito antes de escribir. |
| ¿Storyboard es lo mismo que Editor? | **No, son roles separados** | Storyboard decide qué/cuándo (duración, posiciones, ritmo); Editor ejecuta cómo (render). Confirmado por el patrón repetido en fuentes externas (Hermes Kanban, MindStudio, agentcut). |
| ¿Existe sistema open source ya armado para adaptar? | **No exactamente — se reutiliza el patrón de orquestación, no el código** | agentcut y similares generan video con modelos de IA (Veo/Kling); vos ya tenés Hyperframes haciendo ese trabajo con más precisión. Lo reusable es la separación de responsabilidades y el esqueleto de pipeline, no la integración de generación de video. |
| ¿Necesita un agente "Descubridor" separado del Director? | **No** — se descartó | Cualquier función que se le asignaba (buscar contexto externo, profundizar investigación) terminaba siendo curación, que ya es trabajo del Director. |
| ¿Necesita un agente "Validador" separado del Director? | **No** — se fusionó con el Director | Mismo patrón: cada intento de definir su función única colapsaba en curación. Se resolvió como Director + subagente "mano derecha" (mismo patrón que FlowTask: razonamiento no se satura, delega recuperación de contexto). |
| Rama del Validador que detectaba "falta concepto base asumido" | **Se convirtió en una función del Director**: generar video-hook de bajo costo de producción | Los algoritmos premian volumen; el contenido muy técnico tiene costo de research/producción alto. Los hooks de bajo costo (explicación de conceptos/flujos básicos) sirven de puerta de entrada al perfil para audiencia sin las bases asumidas. |
| ¿Qué devuelve la mano derecha al Director? | **Resultado sintetizado, sin omitir nada relevante** | Evita recrear el problema de saturación de contexto un paso después. Consistente con el criterio de compresión que ya usás en FlowTask (91% reducción de tokens vía LSP/AST-grep). |
| ¿Sesión de la mano derecha fresca o reutilizable? | **Reutilizable, mismo `task_id` durante toda la sesión de curación** | Evita pérdida de razonamiento entre iteraciones — es la tesis de tu propio artículo de dev.to sobre continuidad de sesión en subagentes. |

---

## 4. Preguntas pendientes (definir ANTES de construir)

1. **Criterio de "cuándo el origen/fuente sí es útil" en la síntesis de la mano derecha.**
   Dijiste: "solo lo que necesita saber, no el cómo ni de dónde lo sacó — esta última en algunos casos puede servirle". No quedó definido el criterio de cuándo aplica la excepción. Sin este criterio, el subagente no tiene una regla clara para decidir qué incluir. Ejemplos de posible criterio: cuando la fuente es primaria/autoritativa vs. blog genérico; cuando el Director necesita citarla en el video; cuando el dato es controversial o reciente y su validez depende de la fuente.

2. **Qué formato exacto de output usa la mano derecha al reportar al Director.**
   No se definió si es texto libre, JSON estructurado (tipo `{gap_type, synthesis, source_note?}`), o algo intermedio. Afecta directamente cómo lo vas a implementar (prompt vs. schema forzado).

3. **Definición operativa del "video-hook de bajo costo".**
   Se estableció el *propósito* (puerta de entrada para audiencia sin bases, menor costo de research/producción) pero no la *forma*: ¿usa el mismo pipeline completo (guion→storyboard→Hyperframes) con menos tiempo/profundidad, o es un formato distinto que se salta pasos (ej. sin dual-channel completo)? Esto cambia si el Storyboard y el Editor necesitan lógica condicional según el tipo de pieza.

4. **Formato del "backlog" que consulta el Director y la mano derecha.**
   Se mencionó que el Director "tiene visión del backlog completo" y la mano derecha "busca en el backlog interno o externo" — no se definió dónde vive ese backlog (¿Engram? ¿Notion? ¿un store nuevo?) ni su estructura.

5. **Mecánica de la orquestación (código determinístico) mencionada en §2.**
   Se estableció que existe como capa separada de los agentes, pero no se diseñó — a diferencia de lo que se pensó inicialmente, no hay un `pipeline.py` de FlowTask para reutilizar como referencia directa. Si vas a mirar un esqueleto externo, el más cercano en patrón es `agentcut` (pipeline.py con ejecución paralela + estados por agente vía SSE), pero es orientado a generación de video con modelos de IA, no a tu stack.

---

## 5. Con qué seguir antes de construir

- Resolver las 5 preguntas de §4 — ninguna es bloqueante para seguir diseñando, pero sí lo son para escribir prompts/schemas reales de cada agente.
- Decidir el stack de orquestación (¿LangGraph, o algo más liviano dado que son 4 nodos?).
- Definir el schema de handoff entre cada par de agentes (Director→Guionista, Guionista→Storyboard, Storyboard→Editor) — por ahora está descrito en prosa, no en estructura de datos.
- Decidir si el video-hook (pregunta 3) se diseña ahora como parte de este pipeline o se deja para una iteración posterior una vez el flujo principal esté probado.
