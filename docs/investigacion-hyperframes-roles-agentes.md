# Investigación: Hyperframes, roles profesionales y agentes existentes para ClipLab

**Fecha de la investigación:** 2026-08-22
**Contexto:** pipeline de creación de contenido ClipLab — Director → Mano Derecha → Guionista → Storyboard → Editor (Hyperframes). Este documento consolida todo lo investigado sobre (1) qué es Hyperframes y cómo se relaciona con el pipeline, (2) qué hace realmente cada rol en la industria, y (3) qué sistemas/agentes/skills ya existen y podrían adaptarse.
**Método:** búsqueda web + lectura de repositorios/documentación. Ningún código fue ejecutado ni verificado línea por línea — donde corresponde se marca `[No verificado]`.
**Advertencia de uso:** este archivo es material de referencia crudo, no una decisión de arquitectura. Las tablas de "implementar / no implementar" reflejan el análisis hecho en la conversación, sujeto a que Saez decida en los CAs correspondientes.

---

## 1. Resumen ejecutivo

1. **Hyperframes tiene dos identidades distintas bajo nombres parecidos** — un framework open source (`heygen-com/hyperframes`) orientado a agentes/devs, y un producto enterprise (`hyperframe.ai`) orientado a ensamblar footage licenciado. Son cosas distintas; no deben tratarse como la misma fuente de verdad.
2. El open source **sí** trae generación de storyboard/guion integrada, pero **solo dentro de sus "creation workflows"** (10 skills) — no en el motor de render en sí. Los "domain skills" (9 restantes) son atómicos y no tienen opinión editorial.
3. Para ClipLab, **usar Hyperframes solo como motor de render (domain skills)** evita el solapamiento con los CAs `ca-guion-narrado` y `ca-storyboard-dual-channel` ya definidos. Usar los "creation workflows" sí solapa, porque generan su propio guion/storyboard internamente.
4. Existe al menos un sistema público (`RainLib/AI-Storyboard`) con una arquitectura de agentes casi idéntica a la de ClipLab (Productor + Guionista + Storyboard Artist + Director + Animador), útil como referencia de **proceso y metodología de rol**, pero con un output final incompatible con Hyperframes (genera prompts de texto para modelos de video generativo, no composiciones HTML deterministas).
5. La brecha crítica a resolver antes de adaptar cualquier skill externa: **separar la lógica de decisión del rol (reutilizable) del formato de salida (no reutilizable sin reescribirlo contra el contrato de `/hyperframes-core`)**.

---

## 2. Hyperframes: dos entidades, no confundir

| | `heygen-com/hyperframes` (el relevante para ClipLab) | `hyperframe.ai` |
|---|---|---|
| Naturaleza | Framework open source, Apache 2.0 | Producto/servicio enterprise |
| Qué hace | Convierte HTML/CSS/JS en video MP4 determinístico vía CLI/API, pensado para que agentes de IA escriban la composición | Ensambla video desde footage que la organización ya licenció y aprobó; la IA arma guion/estructura, un humano aprueba antes de publicar |
| Input | Composición HTML con atributos `data-*` de timing | Biblioteca de footage propio, tageada y buscable |
| Relación con storyboard/guion propio | Sí, pero solo en sus "creation workflows" (ver sección 3) | Sí, "AI handles the script, the structure and the scene-matching" — modelo distinto, no aplica al Editor de ClipLab |
| Repositorio/fuente | github.com/heygen-com/hyperframes | hyperframe.ai (sitio comercial, sin repo público) |
| Relevancia para ClipLab | **Alta** — es el motor de render que ya está en el diagrama del pipeline como "Editor" | Baja / no aplica — modelo de negocio distinto (footage curado vs. composición HTML generada) |

**Fuentes:**
- https://github.com/heygen-com/hyperframes
- https://hyperframe.ai/
- https://www.mindstudio.ai/blog/what-is-hyperframes-ai-video-rendering
- https://www.mindstudio.ai/blog/what-is-hyperframes-html-video-renderer-ai-agents

---

## 3. Arquitectura interna de `heygen-com/hyperframes`

El repo ships 20 skills que un agente carga bajo demanda, organizadas en 3 grupos. El grupo "Router" decide cuál de los otros dos cargar.

### 3.1 Router

| Skill | Función |
|---|---|
| `/hyperframes` | Punto de entrada obligatorio para cualquier pedido de crear/editar/animar/renderizar video. Es el mapa de capacidades y quien decide qué "creation workflow" cargar. |

### 3.2 Creation workflows — **NO usar para ClipLab** (generan su propio guion/storyboard)

| Skill | Qué genera internamente | Por qué NO debería usarse en ClipLab |
|---|---|---|
| `/product-launch-video` | Captura un sitio web, extrae identidad de marca, escribe guion y storyboard, genera locución | Duplica `ca-guion-narrado` + `ca-storyboard-dual-channel` — el LLM de Hyperframes decidiría qué contar, invadiendo al Director/Guionista |
| `/faceless-explainer` | Storyboard 100% inventado por el LLM a partir de texto arbitrario | Mismo problema — autoridad creativa que ya asignaste a tus propios CAs |
| `/pr-to-video` | Genera un explicador/changelog desde un PR de GitHub | No aplica al caso de uso de ClipLab, pero mismo patrón de riesgo si se usara |
| `/talking-head-recut` | Decide qué overlays/lower-thirds usar sobre un video existente | Decisión editorial que en ClipLab le corresponde al Storyboard |
| `/motion-graphics` | Diseña un motion graphic corto sin guion narrado | Decisión de diseño que en ClipLab pertenece a Storyboard/Director |
| `/music-to-video` | Un track de música dicta el ritmo del video | Se solapa con la lógica de "correspondencia audio y visual" que ya tiene tu Storyboard |
| `/slideshow` | Genera una deck navegable, no un video | Fuera de alcance del pipeline (no es video) |
| `/general-video` | Fallback genérico, incluye "companion mode" (co-creación con todo el toolbox) | El más peligroso de todos para solapamiento — es un modo abierto de creación conjunta |
| `/remotion-to-hyperframes` | Migración de composiciones Remotion (React) a HTML | No aplica salvo que migres un proyecto Remotion existente |

### 3.3 Domain skills — **SÍ usar, capacidades atómicas sin opinión editorial**

| Skill | Cubre | Para qué le sirve a ClipLab |
|---|---|---|
| `/hyperframes-core` | Contrato de composición: atributos `data-*` de timing, `class="clip"`, tracks, sub-composiciones, reglas de determinismo | Le da al **Storyboard** las reglas de lo renderizable (qué es un segmento válido) y al Editor la base para traducir el storyboard a HTML |
| `/hyperframes-animation` | Reglas de movimiento, adaptadores de runtime (GSAP, Lottie, Three.js, Anime.js, CSS, WAAPI, TypeGPU) | Implementación del Editor — cómo ejecutar el ritmo que el storyboard definió |
| `/hyperframes-keyframes` | Autoría de keyframes seek-safe cross-runtime, diagnósticos de movimiento renderizado | Editor — sincronía cuadro a cuadro si la correspondencia audio-visual lo exige |
| `/hyperframes-creative` | `frame.md`/`design.md`, paletas, tipografía, narración, beat planning, patrones de composición | Zona ambigua — podría pertenecer al Director (voz/tono de marca) o al Storyboard (look visual); no resuelto |
| `/media-use` | Resuelve BGM/SFX/imagen/ícono/logo/voz en archivos listos, genera vía TTS/música/imagen cuando falta en catálogo, transcribe, subtitula | Editor — capa de recursos, no de decisión narrativa |
| `/hyperframes-cli` | Loop de desarrollo: `init`, `lint`, `check`, `snapshot`, `preview`, `render`, `publish`, `doctor`, render en la nube (HeyGen-hosted, AWS Lambda) | Editor — loop operativo |
| `/hyperframes-audio` | Mezcla de audio ya colocado en la composición: voiceover carve, cadena de efectos (EQ, compresor, limitador, etc.), automatización de envolventes | Editor — coincide con "producción del video: correspondencia audio y visual" |
| `/hyperframes-registry` | Instala y conecta bloques/componentes del catálogo (transiciones, overlays, charts) | Editor — componentes reutilizables, no guion |
| `/figma` | Importa assets/tokens/componentes de Figma, incluida reconstrucción de secciones de storyboard | Opcional — solo si el storyboard llega con tokens de Figma |

### 3.4 Instalación mínima recomendada

```bash
npx skills add heygen-com/hyperframes --skill hyperframes-core --full-depth
npx skills add heygen-com/hyperframes --skill hyperframes-animation --full-depth
npx skills add heygen-com/hyperframes --skill hyperframes-cli --full-depth
npx skills add heygen-com/hyperframes --skill media-use --full-depth
npx skills add heygen-com/hyperframes --skill hyperframes-audio --full-depth
```

Evita instalar los 20 por defecto (lo que ocurre con un `skills add` no interactivo sin `--skill`). El flag `--full-depth` es necesario porque sin él la instalación viene del registro `skills.sh`, que puede ir horas desactualizado respecto a `main`.

**Riesgo operativo a fijar en el CA de producción:** si el agente Editor invoca el router `/hyperframes` con un pedido tipo "hazme un video sobre X", el router lo va a encaminar a un *creation workflow* (sección 3.2) en vez de dejarlo operar solo con domain skills. El CA `ca-produccion-video-sincronizado` debería especificar modo "composición ya escrita / CLI directo" y prohibir la entrada vía creation workflows.

**Fuentes:**
- https://github.com/heygen-com/hyperframes (README completo, listado de las 20 skills)
- https://hyperframes.mintlify.app/guides/website-to-video (detalle de `/product-launch-video` / website-to-video)
- https://github.com/heygen-com/hyperframes-launch-video/blob/main/STORYBOARD.md (ejemplo real de `STORYBOARD.md` generado por el propio proyecto)
- https://www.mindstudio.ai/blog/ai-video-generation-workflow-hyperframes-elevenlabs
- https://www.mindstudio.ai/blog/ai-video-editing-claude-code-hyperframes
- https://silenceper.com/en/article/2026-05-02-hyperframes-html-video-rendering/
- https://dev.to/hugh1st/heygen-hyperframes-how-code-is-killing-traditional-video-editing-3f2h

---

## 4. Qué hace cada rol en la industria real (no en abstracto)

| Rol de ClipLab | Fuente principal | Responsabilidad núcleo según la industria | Coincide con tu definición | Diverge de tu definición |
|---|---|---|---|---|
| **Director** | climbtheladder.com (Video Director role) | Es responsable únicamente del contenido creativo — se distingue del productor (logística/presupuesto) y del director de fotografía (ejecución técnica). Unifica visión estética/emocional y coordina departamentos humanos. | La separación "curación editorial vs. logística" sí aplica — tu Director tampoco maneja timing/recursos, eso es de la orquestación determinística | Tu Director no coordina actores ni cinematógrafos; es más parecido a un gatekeeper editorial (evalúa evidencia, aprueba/rechaza) que a un director de cine clásico |
| **Storyboard Artist** | saturation.io / studiobinder.com | Antes de dibujar, lee el guion identificando beats dramáticos, arco emocional, ubicaciones y requisitos visuales. Es el primer visualizador del guion — traduce palabras en imágenes que comunican la visión del director, antes de que empiece la producción. Trabaja en dos modos: ejecuta un brief preciso, o genera soluciones cuando el director "sabe que hay algo pero no sabe qué". | Alto — tu definición ("segmentos y duración, ritmo, correspondencia audio-visual") calza bien con esta función | El artista real dibuja a mano y pitchea en persona al director con loops de feedback iterativos; tu agente no tiene ese ida-y-vuelta humano en tiempo real, es más un handoff de documento |
| **Editor** | studiobinder.com / careerexplorer.com | Corta, arregla y ensambla tomas de la forma que mejor sirva a la historia y a la visión del director, tomando decisiones que afectan ritmo, atmósfera y narrativa. Colabora con diseñadores de sonido y coloristas. | La ejecución técnica del ritmo ya definido por otros sí aplica | El editor real SÍ toma decisiones creativas de ritmo/pacing durante el corte; tu Editor (Hyperframes) explícitamente "no reabre decisiones" — es mucho más estrecho, casi un renderer puro, no un editor con juicio propio |

**Nota metodológica:** los tres roles de la industria están fusionados de forma distinta en tu pipeline de lo que estarían en un set real — esto no es un error, es una compresión razonable dado el volumen, pero significa que no puedes asumir que una skill escrita para "storyboard artist" o "video editor" genérico cubre exactamente lo que tu agente necesita sin adaptación.

**Fuentes:**
- https://climbtheladder.com/what-is-a-video-director-role-responsibilities-and-career-path/
- https://saturation.io/film-crew-positions/storyboard-artist
- https://www.studiobinder.com/blog/what-is-a-storyboard-artist-job-description/
- https://cromatic.shop/articles/what-is-a-storyboard-artist
- https://www.studiobinder.com/blog/what-does-a-film-editor-do/
- https://www.careerexplorer.com/careers/film-and-video-editor/

---

## 5. Sistemas / agentes / skills ya existentes que pueden adaptarse

### 5.1 `RainLib/AI-Storyboard` — el más cercano estructuralmente

```
Producer Agent (CLAUDE.md) — orquestador puro, sin skill propia
├── Scriptwriter        → skill: scriptwriter-skill
├── Storyboard Artist    → skill: film-storyboard-skill
├── Director             → skill: storyboard-review-skill   (SOLO lee, no crea — PASS/FAIL)
└── Animator             → skill: animator-skill
```

Flujo de 5 fases: guion → beat breakdown (9 momentos narrativos clave, con revisión del Director) → beat board (9 prompts de imagen estática, grid 3×3) → sequence board (secuencias de 4 tomas expandiendo un beat clave) → motion prompts (para modelos de video generativo). Cada fase termina con un veredicto PASS/FAIL del Director; 3 fallos consecutivos escalan a intervención del Productor/usuario — mecanismo casi idéntico a tu "detención visible, sin recuperación automática."

Repo: GPL-3.0, 44 estrellas, `[No verificado]` calidad real del código — no se auditó línea por línea, solo se leyó el README y la estructura de archivos.

**Fuente:** https://github.com/rainlib/ai-storyboard

### 5.2 `smixs/creative-director-skill`

Skill de metodología de evaluación de ideas: SIT, TRIZ, Lateral Thinking, bisociación, más un motor de evaluación basado en 571 casos ganadores de Cannes Lions. Explícitamente diseñada para ser "honesta en la evaluación" y "matar la mediocridad" en vez de validar por defecto.

**Fuente:** https://github.com/smixs/creative-director-skill

### 5.3 `smixs/visual-skills`

Dos skills encadenadas: `image` (prompts de dirección de arte para keyframes/storyboards, elige entre Nano Banana y GPT Image 2 según el caso) y `video` (dramaturgia cinematográfica real — Murch, blocking, montaje, regla de 180° — traducida a sintaxis exacta de Seedance 2.5, Kling 3.0, Veo 3.1). El propio repo indica que sin la dramaturgia codificada, "no importa cuán correcta sea la sintaxis, no hay nada que valga la pena renderizar."

**Fuente:** https://github.com/smixs/visual-skills

### 5.4 Storyboard Generator (mcpmarket / walkerhi11)

Convierte guiones de anuncios en storyboards de producción segmentados en clips de 2-4 segundos, con especificaciones de B-roll, cues de música/SFX y prompts optimizados para Sora/Kling/HeyGen. Basado en el "VISCAP AI Framework".

`[No verificado]` — repo con 0 estrellas en GitHub al momento de la consulta; señal de adopción muy baja, tratar como referencia de formato, no como código a instalar con confianza.

**Fuente:** https://mcpmarket.com/tools/skills/storyboard-generator-1

### 5.5 Tabla comparativa — por qué coincide, qué implementar, qué NO implementar

| Sistema | Por qué coincide con ClipLab | Qué SÍ adaptar | Qué NO adaptar (y por qué) |
|---|---|---|---|
| `RainLib/AI-Storyboard` — rol Director | Función idéntica: solo revisa, emite PASS/FAIL, no decide contenido, escala a humano tras fallos repetidos | El checklist de revisión y el ciclo FAIL→revisión→re-revisión — es agnóstico al motor de render | Nada relevante que evitar aquí; es la pieza más directamente portable de todo el hallazgo |
| `RainLib/AI-Storyboard` — Scriptwriter/Storyboard Artist | El *proceso* (leer guion → identificar beats → mantener consistencia de personaje/escena/luz) es igual de válido sin importar el motor de salida | La lógica de "qué preguntar y en qué orden" para llegar a un beat completo, y el principio de continuidad (repetir literalmente los identificadores clave de personaje/escena) | El **formato de salida** (`Visual Description` de 80-120 palabras en prosa para que un modelo de difusión invente la imagen) — esto no es lo que `/hyperframes-core` necesita; reescribir contra atributos `data-*` de composición, no copiar la plantilla tal cual |
| `RainLib/AI-Storyboard` — Animator | Traduce una secuencia estática a movimiento — función análoga a la del Editor | El principio de "mantener consistencia del sujeto + movimiento físicamente plausible" como criterio de calidad | El output (`motion prompts` de texto para modelos de video generativo) — tu Editor no genera video con difusión, ejecuta `/hyperframes-animation`/`/hyperframes-keyframes` sobre HTML ya escrito |
| `smixs/creative-director-skill` | El marco de evaluación "honesta, sin validar por defecto" coincide con el espíritu de tu matriz APPROVE/SCOPE/REQUEST_CONTEXT/DISCARD | La metodología de evaluación estructurada (en vez de juicio libre) como insumo de criterio para el Director | El objetivo de la evaluación en sí — este skill evalúa *conceptos publicitarios/ideas*, no *evidencia técnica propia* como exige tu CA `ca-curador-director`; no copiar los criterios Cannes Lions literalmente |
| `smixs/visual-skills` | Codifica reglas de cine real (montaje, regla de 180°) como reglas ejecutables en vez de teoría — mismo espíritu que darle al Storyboard "las reglas que tiene un storyboard" | Las reglas de dramaturgia/continuidad de cámara (eje de acción, tipos de montaje) como *criterio* que el Storyboard aplica al decidir segmentos | La sintaxis específica de prompt para Seedance/Kling/Veo — cero relevancia para Hyperframes, que no genera video por difusión |
| Storyboard Generator (VISCAP) | Segmentación en bloques de 2-4 segundos con especificación técnica (B-roll, cues) es conceptualmente parecida a tu "segmentos y duración" | La idea de anexar especificaciones técnicas estructuradas (no solo prosa) al lado de cada segmento | Todo el resto — adopción casi nula (`[No verificado]`, 0 estrellas), no hay evidencia de que el código funcione; tratar solo como inspiración de formato, no como dependencia |
| Cualquier "creation workflow" de Hyperframes (sección 3.2) | Coincide en *dominio* (generación de video) pero no en *arquitectura de decisión* | Nada — no hay pieza de estos que debas incorporar a tus agentes | Todo: generan su propio guion/storyboard internamente, exactamente la autoridad que ya le asignaste a Director/Guionista/Storyboard; usarlos como "ayuda para construir criterio" terminaría reemplazando el criterio en vez de informarlo |

**Fuentes adicionales de contexto (menor peso, usadas para descartar o triangular, no como base de recomendación):**
- https://github.com/topics/screenwriting
- https://github.com/topics/creative-director
- https://github.com/topics/creative-direction
- https://github.com/topics/ai-filmmaking
- https://github.com/BehiSecc/awesome-claude-skills
- https://github.com/GetBindu/awesome-claude-code-and-skills
- https://claudemarketplaces.com/skills/smixs/creative-director-skill/creative-director

---

## 6. La advertencia central que atraviesa todo el documento

Todos los sistemas de la sección 5 (excepto los domain skills nativos de Hyperframes) están calibrados para un **vocabulario de salida distinto** al que tu Editor necesita:

- **Su output:** prosa descriptiva densa (80-120 palabras) o prompts de texto que un modelo de difusión/video generativo (Nano Banana, Midjourney, Kling, Veo, Seedance) interpreta para *inventar* la imagen o el movimiento.
- **El output que tu Editor necesita:** HTML/CSS/JS con atributos `data-*` de timing — una composición determinista que Hyperframes renderiza frame por frame, sin generación de contenido visual nuevo por IA.

Esto significa que la **lógica de decisión de cada rol es portable** (qué preguntar, cómo mantener consistencia, cuándo algo está "listo", cómo revisar), pero el **formato de salida de cada skill NO lo es** sin reescritura contra el contrato de `/hyperframes-core`. Adaptar cualquiera de estas skills copiando su plantilla de salida tal cual reintroduce exactamente el problema de frontera identificado antes en la conversación: el Storyboard heredaría un vocabulario ajeno al motor de render real, en vez de las reglas de lo renderizable.

---

## 7. Preguntas que este documento deja abiertas (no resueltas aquí)

1. ¿`/hyperframes-creative` (beat planning, paletas, tono) pertenece al Director o al Storyboard? — ambigüedad señalada en la sección 3.3, no resuelta.
2. ¿Vale la pena clonar/inspeccionar el código real de `RainLib/AI-Storyboard` línea por línea antes de decidir cuánto adaptar, dado que su calidad de implementación no fue verificada?
3. ¿El CA `ca-produccion-video-sincronizado` va a prohibir explícitamente la entrada del Editor vía el router `/hyperframes` (creation workflows), o solo vía domain skills? — pendiente de fijarse como restricción escrita, no solo como intención de diseño.

---

## 8. Estado al 2026-08-26 (actualización documental — hotfix HF-documentacion-proyecto)

Este documento es material de referencia crudo (2026-08-22) y se conserva como histórico. Actualización del estado real en `main` @ `0544df4` (fuente de estado: `docs/pipeline-agentes-contenido.md`):

- `ca-storyboard-dual-channel` fue **implementado y mergeado** (2026-08-23, `d107d8e`; #3600, #4411) — ya no es "solo definido" como indicaba el §1 punto 3.
- `ca-produccion-video-sincronizado` fue **implementado y mergeado** (2026-08-24, `3f3954a`; #3601, #4310). La pregunta §7.3 (entrada del Editor vía el router `/hyperframes`) sigue sin respuesta literal en los prompts materializados: `agents/editor.md` no menciona el router ni los creation workflows (verificado 2026-08-26); la definición vigente del Editor opera contra "Hyperframes CLI with serial queue and failure classification" según `opencode.json`.
- Los **5 agentes de contenido** están materializados en `agents/*.md` (Director, Síntesis, Guionista, Storyboard, Editor) con la capa de memoria en `skill/convenciones-memoria-agentes-contenido/SKILL.md` (#4187, #4190). El Editor (`cliplab-editor`) opera contra el contrato de Hyperframes según su definición vigente (`agents/editor.md`).
- Las preguntas abiertas §7.1 y §7.2 (ambigüedad de `/hyperframes-creative` y auditoría de `RainLib/AI-Storyboard`) siguen vigentes.
