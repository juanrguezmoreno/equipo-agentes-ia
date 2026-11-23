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
