# Propuesta de arquitectura (Fase 0)

> Estado: propuesta de Fase 0 aprobada y actualizada con el diseño de la UI de
> Fase 3. La aplicación sigue sin desplegarse públicamente.

## Objetivo y límites

Una aplicación web de demostración que recibe una petición de cambio para un
proyecto virtual de ejemplo y coordina tres agentes: Orquestador, Develop y
Testing. Develop produce parches versionados en la base de datos, no ejecuta ni
escribe directamente en el sistema de archivos del servidor. Testing aplica
validaciones deterministas a esos artefactos y criterios, además de revisión por
LLM. La UI presenta el progreso y el historial.

Cada invocación procesa como máximo una transición de agente. El workflow se
persiste en Postgres y se puede reanudar; una función serverless nunca ejecuta
el ciclo completo de principio a fin. La API implementa `POST /api/runs` para
crear una ejecución y `POST /api/runs/[runId]/step` para reclamar y ejecutar
un único paso.

## Arquitectura

```mermaid
flowchart LR
  U[Usuario] --> UI[Next.js App Router<br/>panel y cliente Supabase]
  UI -->|Auth + Realtime filtrado por RLS| DB[(Supabase Postgres)]
  UI -->|crear petición / avanzar un paso| API[Route Handlers<br/>Next.js en Vercel]
  API --> AUTH[Verificar sesión y límites<br/>validar Zod]
  AUTH --> DB
  API --> CLAIM[RPC transaccional<br/>claim idempotente + lease]
  CLAIM --> DB
  API --> AGENT{Paso actual}
  AGENT -->|planificar| ORQ[Orquestador]
  AGENT -->|implementar una tarea| DEV[Develop]
  AGENT -->|validar una tarea| TEST[Testing]
  ORQ -->|plan Zod| DB
  DEV -->|artefactos versionados| DB
  TEST -->|informe estructurado| DB
  ORQ --> SDK[Vercel AI SDK<br/>adaptador de proveedor]
  DEV --> SDK
  TEST --> SDK
  SDK --> GEM[Gemini principal<br/>gemini-3.5-flash-lite]
  GEM -. fallo transitorio .-> GEM2[Gemini alternativo<br/>gemini-3.1-flash-lite]
  GEM2 -. fallo transitorio .-> GROQ[Groq Free opcional<br/>GPT-OSS 20B]
  SDK -. AI_PROVIDER=groq .-> GROQ
  DB -->|cambios Postgres/Realtime| UI
```

Las RPC `create_agent_run`, `claim_next_agent_step`, `complete_agent_step` y
`fail_agent_step` mantienen las transiciones atómicas en Postgres. El claim usa
un idempotency key por paso e iteración, un lease de 45 segundos y un lock por
run antes de llamar al modelo. La finalización guarda plan/artefactos/informe,
actualiza estados y registra eventos en la misma transacción; las llamadas
repetidas no duplican artefactos ni completan dos veces el mismo intento.
Errores transitorios se guardan como `next_attempt_at` con backoff
exponencial acotado y jitter; no se mantiene una función dormida. El cliente
reanuda cuando llega el momento. Agotados los reintentos de proveedor, el paso
queda en error visible y recuperable, no en un estado de éxito aparente.
Los endpoints exigen una sesión Supabase válida. `create_agent_run` limita a
cinco runs por propietario y hora con un lock transaccional; es una protección
básica por usuario, no una defensa completa contra creación masiva de cuentas.

## Modelo de datos propuesto

- `runs`: `id`, `owner_id` (Supabase Auth), petición original, estado global,
  versión del esquema, `max_task_iterations`, marcas de tiempo y error final.
- `agent_tasks`: `id`, `run_id`, orden, título, descripción, criterios legibles
  y comprobaciones deterministas tipadas en `acceptance_criteria`, estado,
  iteración actual/límite e informe de test más reciente.
- `artifacts`: `id`, `run_id`, `task_id`, ruta virtual, número de revisión,
  contenido de texto y autor. Inmutable por revisión; el conjunto de revisiones
  más recientes por ruta representa el proyecto virtual.
- `agent_events`: `id`, `run_id`, `task_id` nullable, agente, tipo de evento,
  resumen de entrada/salida, metadatos y `created_at`. Los eventos Testing
  incluirán el informe estructurado completo y el número de iteración, para
  conservar el historial Develop↔Testing sin sobrescribir informes anteriores.
  No se guardan claves de proveedor; los informes y resúmenes pueden contener
  texto derivado de la petición o los artefactos, por lo que no se deben enviar
  datos sensibles.
- `step_attempts`: clave idempotente, agente y tarea, intento de proveedor,
  estado, lease y fecha de próximo reintento. Una fila por intento permite
  auditar las llamadas y los errores sin guardar claves ni respuestas crudas
  del proveedor.

RLS se activa en todas las tablas. En la primera migración, el usuario autenticado
solo puede leer sus runs, tareas, dependencias, artefactos, intentos y eventos;
las escrituras del workflow quedan reservadas al servidor. Las rutas de servidor
deben verificar sesión y propiedad antes de usar la clave elevada, que se
mantiene solo en entorno servidor y nunca se expone al navegador. La publicación
de Realtime incluye únicamente las tablas necesarias y las suscripciones
respetan RLS. El demo usa sesiones anónimas de Supabase Auth; perder los datos
del navegador implica perder el acceso a esa sesión.

Los nombres concretos de la migración inicial son `agent_runs`, `agent_tasks`,
`task_dependencies`, `artifacts`, `agent_events` y `step_attempts`. Se limita
`max_task_iterations` a 1–5 en base de datos (valor inicial 3), se versionan
artefactos inmutables y se deniegan escrituras directas a roles de navegador.

## Máquina de estados

```mermaid
stateDiagram-v2
  [*] --> planning
  planning --> running: plan válido guardado
  planning --> failed: error no recuperable / límite agotado
  running --> developing: tarea pendiente reclamada
  developing --> testing: artefactos válidos persistidos
  developing --> retry_wait: 429 o error transitorio
  retry_wait --> developing: reintento disponible
  testing --> completed_task: comprobaciones + revisión pasan
  testing --> developing: correcciones y quedan iteraciones
  testing --> failed: error y límite de tarea agotado
  completed_task --> developing: queda otra tarea
  completed_task --> completed: no quedan tareas
  running --> cancelled: cancelación explícita
  completed --> [*]
  failed --> [*]
  cancelled --> [*]
```

Estados visibles de tarea: `pending`, `developing`, `testing`, `failed`,
`completed`. Errores transitorios pueden mostrarse como subestado de actividad
sin añadir un sexto estado al tablero. Si una tarea agota sus iteraciones o un
paso termina en error no recuperable, el run falla y las tareas restantes quedan
pendientes; así no se reporta el run como completado cuando una tarea falló.
Esta política se propone para la implementación.

Límite inicial: tres iteraciones Develop↔Testing por tarea, incluyendo la
primera entrega de Develop. El valor se guarda en el run y no se cambia a mitad
del flujo. Cada paso de proveedor tiene un máximo de cuatro intentos persistidos.
Con `AI_PROVIDER=google`, el orden es Gemini principal, Gemini alternativo,
Groq opcional y repetición de Groq; con `AI_PROVIDER=groq`, Groq precede a los
dos modelos Gemini y el cuarto intento repite el último. Los reintentos se
limitan a timeouts y HTTP 408, 425, 429, 500, 502, 503 o 504;
errores permanentes, como HTTP 400, terminan el paso sin reintento. El SDK no
activa reintentos internos.

## Contratos de agentes y verificación

Cada agente tiene prompt de sistema y esquema Zod propio:

- **Plan**: lista acotada de tareas ordenadas, dependencias (si hacen falta),
  criterios de aceptación legibles y aserciones verificables como archivo
  requerido o texto/import/export requerido.
- **Develop**: artefactos `{ path, content }` para el sistema de archivos virtual,
  resumen del cambio y relación con criterios. Solo rutas relativas permitidas,
  extensiones aprobadas y tamaños acotados.
- **Testing**: resultado estructurado, comprobaciones ejecutadas, hallazgos y
  decisión de revisión del modelo, incluyendo evidencia.

Las aserciones generadas por el Orquestador se validan y limitan en servidor.
Testing parsea TypeScript/TSX con TypeScript `transpileModule` (sin ejecutar el
código), JSON con `JSON.parse` y evalúa cada check (`file_exists`,
`contains_text` o `exports_symbol`). Cualquier fallo determinista impide
aprobar y evita gastar otra llamada al modelo. Si todos pasan, el LLM revisa el
parche frente a petición y criterios. Un esquema Zod exige que tanto los checks
como la revisión pasen para que el informe sea aprobado; el LLM no puede anular
fallos deterministas ni producir por sí solo el estado `completed`.

Los esquemas que se envían al proveedor son deliberadamente simples para
mantenerse dentro del subconjunto de JSON Schema y los límites de complejidad
de Gemini. Después de cada respuesta, el servidor valida de nuevo con los
esquemas completos, que aplican longitudes, rutas, dependencias y reglas de
negocio.

`AI_PROVIDER` elige el proveedor prioritario: Google por defecto, o Groq cuando
se selecciona explícitamente. Con Google, `GEMINI_MODEL` (default
`gemini-3.5-flash-lite`) precede a `GEMINI_FALLBACK_MODEL` (default
`gemini-3.1-flash-lite`). Si `GROQ_API_KEY` está configurada, la cadena añade
`GROQ_MODEL` (default `openai/gpt-oss-20b`); `AI_MODEL` solo se acepta como
alias heredado para Groq cuando `AI_PROVIDER=groq`, para evitar que un modelo
Gemini antiguo se use por error con Groq. Ambos modelos Gemini tienen soporte
documentado de structured outputs y precios de nivel gratuito estándar; Google advierte que
puede usar los datos del nivel gratuito para mejorar productos. Groq documenta
strict structured output para GPT-OSS 20B, pero también publica precios de uso
de pago. En esta implementación solo debe configurarse como fallback una
cuenta Groq Free sin método de pago; el usuario confirmó esa condición para su
cuenta y que la cuota agotada devuelve 429. Los límites exactos dependen de la
organización y se deben verificar en su consola. Nunca se deben enviar datos
sensibles. El prompt de sistema se envía en el campo `system`; Groq recibe
`structuredOutputs` y `strictJsonSchema` explícitamente activados. Las llamadas
tienen timeout de 20 segundos y desactivan los reintentos internos del SDK.
Cada intento registra proveedor/modelo en
`agent_events` con resultado y código HTTP, y la UI muestra el último intento
por agente. La salida de cada entrega Develop limita el contenido combinado a
20 000 caracteres; el contexto virtual acumulado se limita a 20 archivos y
48 000 caracteres para evitar prompts sin límite.

## Estructura de carpetas propuesta

```text
app/
  api/runs/route.ts
  api/runs/[runId]/step/route.ts
  page.tsx
components/
  dashboard.tsx
  agent-cards.tsx
  task-board.tsx
  event-timeline.tsx
  code-viewer.tsx
  theme-toggle.tsx
lib/
  agents/                 # prompts y esquemas Zod por agente
  orchestration/           # transiciones puras y reglas de iteración
  ai/                      # adaptador de proveedor y política de reintentos
  supabase/                 # clientes server/browser y tipos DB
  validation/               # validación del FS virtual
supabase/
  migrations/
tests/
  unit/
  e2e/
lib/**/*.test.ts           # pruebas Vitest actuales del núcleo
docs/
  ARQUITECTURA.md
  BITACORA.md
  PROCESO-CLAUDE-CODE.md
```

La ruta API no acepta instrucciones arbitrarias de agente desde el navegador.
Las RPC de workflow y su migración correctiva ya están aplicadas al proyecto
enlazado; el lint remoto no presenta errores. La UI en Fase 3 impulsará un paso
cada vez.

## Interfaz (Fase 3)

- Formulario destacado con tres peticiones de ejemplo, validación visible y
  respuesta a errores y límites.
- Tarjeta por agente con estado derivado del workflow persistido y su último
  resumen registrado; no se simula actividad.
- Tablero en cinco columnas para `pending`, `developing`, `testing`, `failed` y
  `completed`, con número/límite de iteraciones e informes Testing desplegables
  por iteración.
- Timeline cronológico y visor del proyecto virtual con selección de ruta y
  revisión de artefacto.
- Suscripción Realtime filtrada por `run_id`, protegida por RLS; carga inicial,
  refetch en cambios y al reconectar. Postgres es la fuente de verdad.
- Sesión anónima persistente en el navegador, selector de últimas ejecuciones y
  botón para reanudar un run no terminal.
- Diseño responsive con tema claro/oscuro, uso de teclado, etiquetas accesibles,
  regiones de estado y texto además del color.

La migración `20261124140000_store_testing_iteration_reports.sql` guarda
`p_result` y la iteración en los metadatos del evento Testing; el usuario
confirmó su aplicación remota. La migración
`20261124160000_allow_groq_fallback_retry.sql` eleva a cuatro el límite de
reintentos tanto en el RPC de claim como en el RPC de fallo; el usuario confirmó
su aplicación y `migration list --remote` la muestra aplicada.
La migración `20261126170000_align_agent_task_acceptance_criteria.sql` convierte
las filas antiguas al objeto `{criteria, checks}` y alinea su restricción con el
formato que escribe `complete_agent_step`; el usuario confirmó su aplicación y
una consulta remota read-only verificó la restricción.

## Riesgos y mitigaciones

| Riesgo | Mitigación propuesta |
| --- | --- |
| Cuotas gratuitas cambian o se agotan | Configuración por entorno, backoff con jitter, límites de petición e iteración, errores visibles; no asumir cuota ilimitada. |
| Límite de duración serverless | Un paso acotado por invocación, persistencia previa, claim/lease idempotente y reanudación. |
| Dos clientes procesan el mismo run | RPC/transacción de claim, lease y escrituras condicionales; pruebas de concurrencia. |
| Acceso a datos de otros usuarios | Auth, RLS por `owner_id`, claves secretas solo en servidor y pruebas de políticas. |
| Salida del modelo peligrosa o excesiva | Zod, allowlist de rutas, límites de tamaño y parser; no ejecutar el código generado. |
| Criterios vagos | El plan contiene criterios legibles y aserciones deterministas tipadas; Testing devuelve evidencia. |
| Coste/abuso en endpoint público | Cinco runs por propietario/hora, límites de cuerpo/contexto/tokens e iteraciones; protección adicional por IP si la infraestructura lo permite. |
| Realtime duplica o pierde eventos | Postgres como fuente de verdad, carga inicial, reconexión/refetch y eventos append-only. |
| Modelo/proveedor deja de ser compatible | Adaptador separado y pruebas simuladas; secretos y selección por variables. |
| Groq podría generar cargos en una cuenta con facturación | El fallback solo debe configurarse con cuenta Free sin método de pago; confirmar límites en consola y no asumir que las cuotas son ilimitadas. |
| Publicar gratis no equivale a garantía de disponibilidad | Verificar elegibilidad, límites de Vercel Hobby/Supabase y URL al desplegar; documentar límites. |

## Fuentes consultadas

- [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [AI SDK: generación de salidas estructuradas](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [AI SDK: proveedor Google/Gemini](https://ai-sdk.dev/providers/ai-sdk-providers/google)
- [Supabase Realtime: Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase SSR: cliente Next.js y sesiones en cookies](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase Auth: sesiones anónimas](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase CLI: migraciones locales](https://supabase.com/docs/guides/local-development/database-migrations)
- [Supabase Postgres: RLS y grants](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Next.js: archivo Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Gemini API: modelo Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Gemini API: modelo Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Gemini API: precios](https://ai.google.dev/gemini-api/docs/pricing)
- [Groq: strict structured outputs](https://console.groq.com/docs/structured-outputs)
- [Groq: modelos y precios](https://console.groq.com/docs/models)
- [Groq: rate limits](https://console.groq.com/docs/rate-limits)

La búsqueda de herramientas de esta sesión no expuso Context7 ni los MCP de
gestión de Supabase/Vercel. Estas referencias se consultaron directamente en
documentación oficial disponible; antes de implementar se volverá a verificar
la documentación y, si los MCP requeridos están disponibles, se utilizarán para
las operaciones correspondientes.
