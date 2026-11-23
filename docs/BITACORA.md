# Bitácora del proyecto

## Fase 0 — Plan (2026-11-23)

### Petición

Diseñar una aplicación Next.js con tres agentes (Orquestador, Develop y Testing)
que avance mediante pasos serverless breves e idempotentes, persista estado y
artefactos en Supabase, muestre eventos en tiempo real y use Gemini mediante
Vercel AI SDK con proveedor intercambiable. El usuario pidió trabajar por fases,
parar después de cada una y esperar confirmación antes de continuar.

### Decisiones propuestas, pendientes de aprobación

- Usar runs, tareas, artefactos versionados del sistema de archivos virtual,
  eventos de agente y reservas de pasos/reintentos como modelo de persistencia.
- Una invocación de servidor realiza un paso y nunca ejecuta el workflow entero.
- Usar Zod para los contratos de los tres agentes; Testing combina parseo y
  aserciones deterministas con revisión LLM, sin que esta pueda anular fallos
  deterministas.
- Proponer Supabase Auth + RLS para aislar propietarios, y Realtime como señal
  de actualización con Postgres como fuente de verdad.
- Proponer tres iteraciones Develop↔Testing como límite inicial por tarea,
  sujeto a aprobación.
- Mantener selección de proveedor/modelo por entorno; claves locales en
  `.env.local`, fuera de Git, y secretos de despliegue configurados en paneles.
- Registrar los límites variables de planes gratuitos como riesgo, no prometer
  disponibilidad o cuota ilimitada.

### Herramientas y documentación

- Estado inicial: directorio sin archivos de aplicación; rama Git `main` limpia.
- Se buscó Context7 y MCP de Supabase/Vercel, pero la búsqueda de herramientas
  disponible no los expuso. No se crearon proyectos ni se hicieron cambios
  remotos.
- Se consultaron las páginas oficiales de Next.js Route Handlers, AI SDK
  structured output, AI SDK Google/Gemini y Supabase Realtime Postgres Changes.
- No se ha escrito código ni se ha iniciado Fase 1.

### Entregables de esta fase

- `CLAUDE.md`: convenciones de trabajo y seguridad.
- `docs/ARQUITECTURA.md`: propuesta de arquitectura, datos, estados, carpetas,
  UI y riesgos, pendiente de aprobación.

### Aprobación

Fase 0 aprobada por el usuario el 2026-11-23. Sus entregables se publicaron en
el commit `c26d8bd` (`docs: add phase 0 architecture proposal`) en `origin/main`.

## Fase 1 — Base

### Petición

El usuario aprobó Fase 0 e indicó que el repositorio está conectado a GitHub y
que se debe hacer push al terminar cada fase.

### Implementado

- Scaffold de Next.js App Router con TypeScript, Tailwind CSS y ESLint; Node.js
  24 y npm.
- Instalados `@supabase/ssr`, `@supabase/supabase-js` y Supabase CLI. Añadidos
  clientes tipados de navegador/servidor y `proxy.ts` para refrescar sesiones
  con `getClaims()`.
- Enlazado el proyecto Supabase existente `equipo-agentes-ia`; no se creó un
  proyecto nuevo.
- Migración versionada aplicada al proyecto remoto con tablas de runs, tareas,
  dependencias, artefactos, eventos e intentos; límites de tamaño/iteraciones,
  RLS de lectura por dueño y publicación Realtime.
- Tipos TypeScript generados desde el esquema remoto en `types/database.ts`.
- `.env.example` con placeholders, `.env.local` ignorado y README basado en
  conexión al remoto.
- Confirmado en remoto que las seis tablas tienen RLS, las seis políticas son
  de lectura, `authenticated` puede leer pero no insertar, `anon` no puede leer
  y solo runs, tareas, artefactos y eventos están en `supabase_realtime`.

### Validación y límites

- Context7 y el MCP de Supabase no aparecieron en las herramientas disponibles.
  Se consultó directamente documentación oficial de Next.js, AI SDK y Supabase
  (migraciones, RLS, Realtime, Auth anónima y SSR).
- Se intentó `supabase start` antes de que el usuario indicara explícitamente no
  usar Docker ni Supabase local; falló porque Docker Engine no estaba activo.
  Después se respetó esa instrucción y todas las operaciones de base de datos se
  hicieron solo contra el proyecto remoto existente.
- El dry run mostró únicamente `20261123110000_create_agent_workflow.sql`; se
  aplicó con `npx supabase db push --remote --yes`. `migration list --remote`
  confirma la misma versión en local y remoto; `db lint --remote` informa que no
  hay errores de esquema.
- La consulta inicial de grants desde `information_schema.role_table_grants`
  no devolvió filas por la visibilidad del rol de consulta; se verificaron los
  privilegios efectivos con `has_table_privilege` y se confirmó el resultado.
- `npm run lint` y `npm run build` pasan. La prueba pgTAP no se ejecutó porque
  está destinada a un entorno desechable local y no se debía usar Supabase local.
- `enable_anonymous_sign_ins = true` está en la configuración versionada de CLI;
  no se hizo push de configuración global del proyecto para evitar sobrescribir
  ajustes remotos no relacionados. Habilitarlo en el dashboard se hará antes de
  depender del inicio anónimo en la aplicación.
- `.env.local` se comprobó ignorado por Git y `.env.example` queda versionable.

### Cierre

Lint, build, lint remoto y catálogo/grants RLS han sido comprobados. El esquema
está aplicado al proyecto existente y el historial local/remoto coincide. La
prueba pgTAP no se ejecutó porque el usuario pidió explícitamente no usar Docker
ni Supabase local. Antes de usar el flujo de la aplicación habrá que habilitar
Anonymous Sign-Ins en la configuración Auth del proyecto; no se modificaron
ajustes remotos ajenos a la migración.

La Fase 1 queda lista para commit y push a `origin/main`.

## Fase 2 — Agentes y estados (en curso)

### Petición

El usuario indicó «continua» para iniciar la Fase 2 y reiteró que el trabajo
debe avanzar de forma secuencial, verificarse y publicarse al terminar la fase.
Se mantienen las decisiones aprobadas: una invocación corta por paso, Gemini
por Vercel AI SDK con proveedor seleccionable, artefactos virtuales no ejecutados,
Zod, Testing determinista más revisión LLM, iteraciones acotadas y log de eventos.

### Implementado localmente

- Añadidos AI SDK, adaptadores Google/Groq, Zod y Vitest; el cliente selecciona
  proveedor/modelo por entorno, desactiva reintentos internos/telemetría y limita
  cada llamada del modelo a 20 segundos.
- Añadidos contratos y prompts del Orquestador, Develop y Testing; límites de
  tareas, archivos y contenido; validación de dependencias y ciclos.
- Añadida máquina de estados pura con selección por dependencias, límite de
  iteraciones y backoff exponencial con jitter.
- Añadidas comprobaciones de sintaxis TypeScript/TSX sin ejecutar los artefactos,
  parseo JSON y checks deterministas de aceptación. Un fallo determinista bloquea
  la revisión LLM; el esquema del informe no permite que el LLM anule los checks.
- Añadido cliente Supabase de servidor con service role, protección por sesión
  Supabase en endpoints, creación de runs limitada a cinco por propietario/hora
  y endpoint que procesa como máximo un paso por invocación.
- Añadida migración local con RPC transaccionales para crear runs, reclamar
  leases, guardar planes/artefactos/informes y agendar fallos/reintentos.
- El usuario aplicó `20261124120000_add_agent_step_workflow.sql` con
  `npx supabase db push --remote`. `migration list --linked` confirma que está
  registrada en el proyecto correcto; los cuatro RPC existen y solo son
  ejecutables por `service_role`. Los tipos de BD se regeneraron desde remoto.
- Añadidas pruebas Vitest con generador LLM simulado para schemas, dependencias,
  iteraciones, backoff, salidas de agentes y bloqueo ante fallos deterministas.

### Validación y bloqueo actual

- `npm test -- --reporter=dot`: 11 pruebas pasan.
- `npx tsc --noEmit`, `npm run lint` y `npm run build`: pasan.
- `npx supabase db lint --linked` encontró un error en la asignación del enum
  `run_status` dentro de `claim_next_agent_step`, además de avisos de una
  variable redundante en `complete_agent_step`. Se confirmó mediante consulta
  remota de solo lectura que las correcciones preparadas coinciden con ambas
  definiciones instaladas.
- Se preparó `20261124130000_fix_agent_workflow_lint.sql`, posterior al timestamp
  de la migración aplicada. El usuario la aplicó con `npx supabase db push
  --remote`, siguiendo la instrucción de que futuras migraciones se preparen
  aquí y las aplique el usuario.
- `migration list --linked` confirma que las migraciones hasta `20261124130000`
  coinciden local/remoto. La consulta remota de solo lectura confirma el cast
  a `public.run_status` y que las RPC permanecen ejecutables solo por
  `service_role`; `db lint --linked` finaliza sin errores.
- Context7 y el MCP de Supabase no estuvieron disponibles; se usó la CLI
  autenticada y `db query --remote --read-only` para verificar el proyecto,
  las funciones y sus permisos. `db lint --remote` requirió credenciales DB no
  presentes en el entorno de la CLI; el modo `--linked` sí devolvió los
  diagnósticos del lint remoto.

### Estado

La implementación y la migración están verificadas; falta registrar el commit
documental y publicar ambos commits en `origin/main`. No empezar Fase 3 hasta
completar ese push y recibir confirmación del usuario.

El commit de implementación es `5645fd4`
(`feat(agents): implement persisted agent step workflow`). Esta bitácora y la
documentación de arquitectura/uso se registran en un commit documental separado
antes del push de cierre de fase.
