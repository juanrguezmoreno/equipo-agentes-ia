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

Pendiente de confirmación del usuario. No avanzar a Fase 1 hasta recibirla.
