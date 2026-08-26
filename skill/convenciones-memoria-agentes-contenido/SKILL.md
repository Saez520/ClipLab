---
name: convenciones-memoria-agentes-contenido
description: "Convenciones de memoria para los 5 agentes de contenido (Director, Editor, Guionista, Síntesis, Storyboard): namespaces propios, un dueño por namespace, proponer antes de guardar, no modificar definiciones vigentes. Cargá esta skill antes del primer mem_search/mem_save."
license: MIT
compatibility: opencode
metadata:
  category: memory
  scope: cliplab
---

# Convenciones de Memoria — Agentes de Contenido

**Propósito**: capa de memoria sobre los 5 agentes de contenido (Director, Editor, Guionista, Síntesis y Storyboard) sin modificar sus definiciones vigentes (#4187: "solo agrega capa de memoria encima"). La memoria almacena convenciones, decisiones y descubrimientos; la continuidad operativa sigue siendo el soporte determinístico (API).

---

## Reglas mínimas

1. **Namespaces propios** — cada rol guarda en `content-agents/{rol}/*`.
2. **Un dueño por namespace** — el rol dueño escribe; los demás solo leen.
3. **Proponer antes de guardar** — escribir en namespace ajeno o nuevo requiere propuesta previa y confirmación.
4. **No modificar definiciones vigentes** — la memoria no cambia los prompts ni el registro de agentes.

---

## Mapa de ownership

Cada namespace tiene un **dueño** que es el único agente autorizado a escribir en él. Otros agentes pueden LEER pero nunca ESCRIBIR.

| Topic Key Pattern | Owner | Qué escribe | Lectores |
|-------------------|-------|-------------|----------|
| `content-agents/director/*` | cliplab-director | Decisiones, convenciones y descubrimientos del Director | Demás roles (lectura) |
| `content-agents/editor/*` | cliplab-editor | Decisiones, convenciones y descubrimientos del Editor | Demás roles (lectura) |
| `content-agents/guionista/*` | cliplab-guionista | Decisiones, convenciones y descubrimientos del Guionista | Demás roles (lectura) |
| `content-agents/sintesis/*` | cliplab-sintesis | Decisiones, convenciones y descubrimientos de Síntesis | Demás roles (lectura) |
| `content-agents/storyboard/*` | cliplab-storyboard | Decisiones, convenciones y descubrimientos del Storyboard | Demás roles (lectura) |
| `content-agents/convenciones/*` | Runner | Convenciones cross-rol | Todos los roles (lectura) |

---

## Convención 7 — Continuidad (#4190)

La continuidad operativa de cada agente de contenido sigue siendo el **soporte determinístico** (API); la memoria es una **capa complementaria** de convenciones, decisiones y descubrimientos.

---

## Protocolo de escritura

### 1. Buscar (mem_search)

Buscá en Engram antes de guardar o de asumir que un `topic_key` está libre. `mem_search` es barato; asumir es caro. Si una búsqueda no resuelve, simplificá o consultá `mem_suggest_topic_key`.

### 2. Verificar ownership (topic-keys-convention)

Cada `topic_key` tiene un **owner** que es el único agente (o grupo) autorizado a escribir en él. Otros agentes pueden LEER pero nunca ESCRIBIR. Si no estás seguro del `topic_key`, usá `mem_suggest_topic_key` primero y reutilizalo.

### 3. Proponer antes de guardar

Si no sos el dueño del namespace, o el namespace es nuevo, **proponé primero** y esperá confirmación antes de `mem_save`. Escribir en namespace ajeno o nuevo sin propuesta viola la regla mínima 3.

### 4. Guardar (mem_save)

Formato de `content`:

- **What**: una línea — qué se hizo.
- **Why**: qué lo motivó (request del usuario, bug, performance).
- **Where**: archivos o rutas afectadas.
- **Learned**: gotchas, edge cases, sorpresas (omitir si no aplica).

Guardá INMEDIATAMENTE después de: decisión de arquitectura/diseño, bugfix completado, descubrimiento no obvio, configuración, patrón establecido, preferencia o restricción del usuario, implementación de artifacto de plan.

### 5. Referenciar con backticks

Usá SIEMPRE backticks al referenciar `topic_key`s en documentación y en memorias.

---

## Tipos y formato canónico

Categorías oficiales de `type`: `ca-artifact | decision | architecture | bugfix | pattern | config | discovery | pending`.

Todo `topic_key` sigue el formato canónico `{namespace}/CA-{ID}[/{sub-namespace}]`. El hotfix es la excepción oficial: `hotfix/{id}/artifact/{filename}`.

---

## Restricciones

- NUNCA compartas un `topic_key` entre agentes sin verificar ownership.
- NUNCA uses `flow-state/{ID}` sin sub-namespace.
- NUNCA escribas en `project/{layer}` si no sos el Initializer.
- SIEMPRE hacé `mem_search` antes de asumir que un `topic_key` está libre.
- NUNCA modifiques las definiciones vigentes de los 5 agentes: la memoria es una capa encima, no un reemplazo.