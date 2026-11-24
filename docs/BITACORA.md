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

## Fase 3 — Interfaz (en curso)

### Petición

El usuario habilitó Anonymous Sign-Ins y preparó `.env.local`, indicando que no
se lean ni muestren sus valores; solo se puede comprobar la presencia de las
variables. Aprobó la Fase 3 y pidió tarjetas claras para los tres agentes,
timeline Realtime, tablero con estado e iteración, historial del código e
informes por iteración, ejemplos de un clic, diseño responsive/accesible con
modo oscuro y una prueba real con Playwright más capturas. También pidió
verificar en documentación actual un modelo Gemini del nivel gratuito y
configurarlo con una variable de entorno.

### Implementado localmente

- Sustituida la portada de scaffold por el panel de equipo, petición con tres
  ejemplos, selector de ejecuciones, tarjetas de agente, tablero de cinco
  estados, timeline, visor de revisiones virtuales y guía breve del flujo.
- La UI inicia sesión anónima si no hay sesión, carga el historial con RLS y
  usa suscripciones Realtime filtradas por `run_id`, con consulta inicial,
  refresco al recibir eventos y refetch ante desconexión.
- El navegador impulsa pasos secuenciales del endpoint corto, espera la fecha de
  reintento o vencimiento del lease, muestra errores y permite reanudar runs no
  terminales. Hay un límite local de pasos por sesión; la máquina de estados y
  los límites de iteración permanecen en Postgres.
- Se añadió vista de criterios y reportes Testing. La última versión de un
  informe existente se recupera temporalmente desde `agent_tasks`; para mostrar
  el cuerpo completo de todas las iteraciones se preparó la migración
  `20261124140000_store_testing_iteration_reports.sql`. El usuario confirmó
  que la aplicó al proyecto remoto.
- Tema claro/oscuro con preferencia persistida, estilos responsive, controles
  etiquetados y mensajes accesibles.
- Google Gemini usa `GEMINI_MODEL`, cuyo default actual es
  `gemini-3.5-flash-lite`; Groq usa `GROQ_MODEL`, con compatibilidad heredada
  con `AI_MODEL` cuando Groq es el proveedor prioritario.
- La documentación oficial consultada el 24-11-2026 lista Gemini 4 Hydrogen y
  Gemini 3.8 Flash como modelos estables, gratuitos en el nivel estándar y
  compatibles con salida estructurada. Las primeras ejecuciones reales del
  Orquestador agotaron los reintentos (timeouts y respuestas 503). Se seleccionó
  Gemini 3.5 Flash-Lite como default: también es estable, admite salida
  estructurada, y la documentación lo describe como optimizado para tareas
  agénticas de baja latencia. El nivel estándar indica tokens de entrada/salida
  sin coste. Se mantiene `GEMINI_MODEL` configurable. Google advierte que el
  contenido de este nivel puede usarse para mejorar productos; no enviar datos
  sensibles.

### Herramientas, validación y pendiente

- Context7 y el MCP de Supabase no estuvieron disponibles; se consultaron
  páginas oficiales actuales de Gemini y se mantuvo el registro previo de las
  consultas oficiales de Next.js, AI SDK y Supabase.
- `npm test` (19 pruebas), `npx tsc --noEmit`, `npm run lint` y `npm run build`
  pasan tras la implementación y las últimas correcciones.
- Playwright confirmó el inicio de sesión anónima y la suscripción Realtime.
  Cinco ejecuciones reales no completaron el flujo: dos con Gemini Hydrogen
  agotaron reintentos por error/timeouts, una con Gemini 3.8 Flash recibió
  503/timeouts y las dos con Gemini 3.5 Flash-Lite devolvieron HTTP 400. La
  última se hizo después de que el usuario confirmara que había verificado o
  corregido la configuración. Una consulta sin credenciales recibió HTTP 403,
  confirmando conectividad con el endpoint; no se consultaron ni mostraron
  valores de `.env.local`. No se inició una sexta ejecución para respetar el
  límite de cuota por propietario.
- A petición del usuario se creó `scripts/diagnose-gemini.ts`. Sin imprimir la
  clave, el script confirmó que `gemini-3.5-flash-lite` está disponible para
  este proyecto y que una llamada simple de texto funciona. La llamada con el
  `PlanSchema` original devolvió HTTP 400: Gemini rechaza su complejidad de
  restricciones (arrays acotados, longitudes, regex y dependencias numéricas).
  Se separaron esquemas de generación simplificados de los esquemas completos
  de validación en servidor, y se añadió logging del mensaje del proveedor con
  redacción de claves.
- Tras esos cambios se intentó una sola ejecución real en Playwright; Supabase
  primero la bloqueó con HTTP 429 (`Run limit reached. Try again in an hour.`)
  antes de llamar a Gemini. Tras esperar el reinicio y repetir una sola vez, el
  run se creó, pero Gemini devolvió HTTP 503 en los tres intentos configurados:
  el mensaje indica alta demanda temporal. El esquema simplificado ya no
  devolvió el error 400 anterior. No se hicieron más solicitudes.
- La captura de Playwright muestra la interfaz y el estado fallido del último
  run. No demuestra un ciclo exitoso Orquestador–Develop–Testing. Falta que el
  proveedor vuelva a estar disponible para verificar el flujo completo; después
  se puede hacer la validación final, commit y push.
- El usuario confirmó que aplicó la migración de informes mediante
  `npx supabase db push --remote`.

### Resiliencia de proveedores (2026-11-26)

#### Petición y decisiones

Tras los HTTP 503 de Gemini, el usuario pidió que cada paso pruebe Gemini
principal → otro Gemini gratuito → Groq Free, con reintentos exponenciales con
jitter solo ante errores transitorios, proveedor/modelo visibles en eventos y
tarjetas, tests simulados y otra ejecución real. Confirmó que su cuenta Groq
Free no tiene método de pago, no genera cargos y devuelve 429 al agotar límites.

Se verificaron las páginas oficiales actuales: Gemini 3.5 Flash-Lite y
3.1 Flash-Lite son estables, admiten structured output y sus páginas listan
precios de entrada/salida sin coste en Standard Free Tier; Groq GPT-OSS 20B
admite strict structured output, pero la documentación también publica precios
de pago y límites base del Developer plan. Los límites exactos dependen de la
organización; para mantener el coste cero, Groq solo se debe configurar con una
cuenta Free sin método de pago. Fuentes: documentación oficial de [Gemini
3.5](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite),
[Gemini 3.1](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite),
[precios Gemini](https://ai.google.dev/gemini-api/docs/pricing),
[Groq structured outputs](https://console.groq.com/docs/structured-outputs),
[modelos Groq](https://console.groq.com/docs/models) y
[rate limits Groq](https://console.groq.com/docs/rate-limits).

#### Implementado localmente

- Cadena configurable: Gemini principal (`GEMINI_MODEL`), Gemini alternativo
  (`GEMINI_FALLBACK_MODEL`) y Groq (`GROQ_MODEL`) si hay clave. Groq puede ser
  primario con `AI_PROVIDER=groq`; `AI_MODEL` se usa como alias heredado solo en
  ese caso, para que una configuración antigua de Gemini no seleccione un
  modelo Gemini en la API de Groq.
- Default Gemini principal `gemini-3.5-flash-lite`, fallback
  `gemini-3.1-flash-lite` y Groq `openai/gpt-oss-20b`. Los esquemas enviados son
  simples y estrictos; el servidor vuelve a validar cada respuesta con los
  esquemas completos de Zod.
- Límite ampliado a cuatro intentos persistidos: Gemini principal, Gemini
  alternativo, Groq y un reintento Groq. Cada intento es una invocación corta;
  la RPC programa el siguiente usando backoff exponencial con jitter. El SDK no
  hace reintentos internos.
- Reintentos solo para timeout y HTTP 408, 425, 429, 500, 502, 503 y 504. El
  `Retry-After` del proveedor se acota; errores permanentes como HTTP 400 no se
  reintentan.
- Se registra `provider_attempt` con proveedor, modelo, número de intento,
  resultado y código HTTP. Las tarjetas muestran el último proveedor/modelo y
  el timeline etiqueta el evento.
- Se añadieron tests simulados para selección de modelos, cadena, fallback,
  redacción de claves, clasificación transitoria, presentación del proveedor y
  backoff.
- Se añadió la migración
  `20261124160000_allow_groq_fallback_retry.sql`; eleva el límite en los RPC de
  claim y fallo. El usuario aplica las migraciones remotas; no se ejecutó
  `db push` desde esta sesión.

#### Validación y estado

La validación local termina con 35 tests, lint, TypeScript y build correctos.
El usuario aplicó las migraciones hasta `20261124160000`; `migration list
--remote` confirma la versión y `db lint --linked --schema public --fail-on
error` no encuentra errores en el esquema remoto. `.env.local` sigue ignorado
por Git; se comprobó únicamente la presencia de las claves necesarias, sin leer
ni mostrar sus valores.

Playwright ha lanzado cuatro runs reales de contacto:

1. El primer run acabó con `agent_step_error`, sin plan.
2. Gemini 3.5 y 3.1 devolvieron 503; el fallback Groq dio 404 porque el alias
   `AI_MODEL` del entorno tenía un nombre Gemini.
3. Tras corregir el alias, Gemini 3.5 y 3.1 volvieron a devolver 503; Groq
   `openai/gpt-oss-20b` generó salida, pero Zod rechazó rutas y una dependencia.
   Se precisó el prompt con las restricciones de ruta y referencias 1-based.
4. Con el prompt ajustado, Gemini 3.5 generó el plan. Supabase rechazó guardarlo
   con `23514`: `agent_tasks_acceptance_criteria_check` exigía un array, aunque
   `complete_agent_step` persiste `{criteria, checks}`. Una consulta remota
   read-only confirmó la definición de la restricción.

Se preparó `20261126170000_align_agent_task_acceptance_criteria.sql`: convierte
filas antiguas de array al objeto actual y exige arrays `criteria`/`checks`
dentro del objeto. El usuario confirmó que la aplicó; la consulta remota
read-only confirmó la restricción y el valor por defecto, y `db lint` no
encontró errores. El run 4 se reanudó después de aplicar la migración.

Como regla permanente, el usuario autorizó hasta 10 ejecuciones reales al día
con modelos verificados en planes gratuitos sin pedir permiso. Se deben
inspeccionar y diagnosticar logs entre ejecuciones y no repetir a ciegas; pedir
permiso solo para superar el límite o si existe posibilidad de coste.

#### Diagnóstico posterior (2026-11-26)

- Tras el HTTP 400 de Groq, se consultó el código del proveedor AI SDK instalado:
  GPT-OSS 20B se reconoce para razonamiento, pero su capacidad de JSON Schema
  figura como desconocida en el catálogo local. Se cambió el prompt de sistema
  para enviarlo como mensaje `system` separado (también a Groq), se activaron
  explícitamente `structuredOutputs` y `strictJsonSchema` y se acotó el plan
  para reducir el tamaño potencial de la salida.
- Tests, lint, TypeScript y build volvieron a pasar antes de la nueva prueba.
- Se inició un quinto run real. Gemini 3.5 Flash-Lite y 3.1 Flash-Lite volvieron
  a responder HTTP 503; el siguiente paso acabó en `provider_timeout` tras unos
  20 segundos, sin código HTTP. El flujo no llegó a Develop ni Testing.
- Esta prueba se inició cuando ya se había alcanzado el límite diario
  conservador de llamadas a modelo. No se harán más llamadas reales hoy; la
  siguiente se pospone hasta el reinicio diario y solo después de revisar estos
  logs y la configuración.
- La Fase 3 continúa abierta: no hay ciclo real exitoso, capturas de éxito,
  commit/push de la fase ni despliegue público.

## Cambio de herramienta: de GitHub Copilot a Claude Code (2026-11-23)

### Nota de transparencia

Las fases 0 a 3 (hasta el commit `0de7ae4`) se desarrollaron por error con
GitHub Copilot en modo agente, no con Claude Code como estaba previsto. Los
commits `c26d8bd` a `13db2ed` llevan el trailer `Co-authored-by: Copilot`, que
lo confirma. A partir de esta entrada el trabajo continúa con Claude Code.

Consecuencias que se dejan constancia:

- Las entradas anteriores de esta bitácora las redactó Copilot. Claude Code no
  ha vuelto a verificar cada afirmación; sí ha comprobado que el árbol está
  limpio, que `0de7ae4` está en `origin/main` y que tests, TypeScript y lint
  pasan.
- Algunas fechas anteriores no cuadran: hay entradas fechadas el 24 y el
  26-11-2026, pero todos los commits y todas las runs de la base de datos son
  del 23-11-2026. Las fechas reales son las de Git y Supabase.
- Las referencias a que Context7 o los MCP no estaban disponibles describen el
  entorno de Copilot. En Claude Code sí están disponibles y se usan.

### Petición

Revisar la cadena de fallback para que un 503 de Gemini pase enseguida al
siguiente proveedor sin consumir reintentos. Ajustar el timeout por proveedor
sin superar el límite de duración de Vercel Hobby. Aplicar la regla de hasta
10 ejecuciones reales al día. Cuando un ciclo completo funcione, hacer capturas
con Playwright, commit y push.

### Diagnóstico

- Antes, cada invocación probaba un único proveedor: el intento persistido N
  usaba el proveedor N de la cadena. Un 503 de Gemini consumía un intento
  persistido y esperaba un backoff antes de probar el siguiente proveedor.
- El timeout era de 20 s para todos los proveedores. Era ajustado para salidas
  grandes de Develop (hasta 5000 tokens) y explica el `provider_timeout` de
  Groq.
- Documentación consultada: la página de duración de Vercel Functions indica
  que Hobby con Fluid compute tiene 300 s por defecto y 300 s como máximo. El
  límite efectivo de este proyecto es el lease de la RPC, que admite como
  máximo 60 s. La documentación del AI SDK (`timeout` de `generateText`) se
  consultó vía Context7.

### Implementado

- `executeProviderChain` recorre la cadena completa en una sola invocación. Un
  error transitorio pasa al siguiente proveedor sin espera, un error permanente
  corta la cadena, y solo si fallan todos se persiste un reintento con backoff.
  Cada intento persistido vuelve a empezar por el principio de la cadena.
- Timeouts: 25 s para Gemini y 30 s para Groq, siempre acotados al presupuesto
  restante de 45 s por invocación. No se inicia un proveedor si quedan menos de
  8 s. La ruta declara `maxDuration = 60` y pide un lease de 60 s. No hace
  falta ninguna migración.
- Cada proveedor probado genera un evento `provider_attempt` con su posición
  en la cadena y su duración. El log de error del servidor resume la cadena.
- Tests: 40 pasan, incluidos los casos de 503 → siguiente proveedor, error
  permanente, cadena agotada, presupuesto acotado y presupuesto insuficiente.
  TypeScript y lint pasan.

### Regla de ejecuciones reales

`CLAUDE.md` ya contenía la regla de hasta 10 ejecuciones reales al día sin
pedir permiso, y no había en él ninguna regla más restrictiva. Queda sin efecto
la restricción adicional de la entrada anterior («límite diario conservador de
llamadas a modelo»).

Una consulta read-only a Supabase muestra que hoy (23-11-2026) ya existen 11
runs: 10 en estado `failed` y 1 en `retry_wait`, todas de sesiones anteriores.
El cupo diario estaba por tanto agotado. Se preguntó al usuario y decidió que
esas 11 runs no cuentan: el cupo de 10 se cuenta desde este punto.

### Ejecuciones reales (2 de 10 hoy)

Ambas se lanzaron con Playwright contra `next dev` local, en una sesión anónima
nueva. Los logs se revisaron mediante eventos y runs en Supabase (consultas
read-only) antes de pasar a la siguiente.

1. **README** (16:27 UTC): Completada en unos 14 s. En los tres pasos, Gemini
   3.5 y 3.1 Flash-Lite devolvieron HTTP 503 en 0,4–4,7 s y la misma invocación
   pasó a Groq `openai/gpt-oss-20b`, que respondió en menos de 1 s. Se detectó
   que los eventos `provider_attempt` de un mismo paso, insertados en un solo
   `INSERT`, compartían `created_at`. Se cambió a una inserción por evento para
   conservar el orden de la cadena.
2. **Página de contacto** (16:29 UTC): Completada en unos 20 s, con una
   iteración real Develop↔Testing. Plan y primera entrega llegaron por Groq
   tras dos 503 de Gemini. Testing bloqueó la iteración 1 por 4 checks
   deterministas fallidos, sin llamar al LLM. Develop corrigió en la iteración
   2, esta vez con Gemini 3.5 Flash-Lite disponible (5,4 s), y Testing aprobó
   con checks y revisión LLM (4,8 s). Los eventos aparecieron en orden.

Capturas en `docs/screenshots/`: `fase3-ciclo-completo-oscuro.png`,
`fase3-ciclo-completo-claro.png`, `fase3-ciclo-completo-movil.png` (390 px, sin
scroll horizontal) y `fase3-iteracion-develop-testing.png`. La consola del
navegador no muestra errores ni avisos.

### Limitaciones y pendientes

- Validado solo en local (`next dev`). No hay despliegue en Vercel; el
  `maxDuration` y el presupuesto de tiempo no se han probado en producción.
- El log de desarrollo de Next (`.next/dev/logs`) serializa como `{}` los
  objetos de `console.error`; el diagnóstico se hizo con eventos de BD.
- Con el informe de Testing desplegado, la columna «Completada» del tablero es
  estrecha y recorta etiquetas como «HALLAZGOS» y «APROBADO».
- Gemini devolvió 503 en casi todas las llamadas: hoy el flujo depende en la
  práctica de Groq Free.

### Estado

Ciclo completo plan → develop → testing → completada verificado dos veces con
modelos gratuitos. Tests (40), TypeScript, lint y build pasan. Queda pendiente
la aprobación del usuario para cerrar la Fase 3.

## Fase 3.5 — Rediseño visual (2026-11-23)

### Petición

La interfaz funcionaba, pero tenía aspecto de plantilla genérica. El usuario
pidió que pareciera un producto real hecho por un design engineer, con estas
condiciones:

- Proponer tres direcciones visuales y esperar su elección.
- Definir los design tokens en un solo sitio.
- Dar a cada agente una identidad propia.
- Evitar los clichés de la IA genérica.
- Movimiento con propósito, rápido, interrumpible y con soporte para
  `prefers-reduced-motion`.
- Microinteracciones, skeletons y estados vacíos útiles.
- Accesibilidad AA y modo claro/oscuro.
- Capturas antes y después.
- No tocar la lógica de los agentes.

### Skills usadas

Skills instaladas en `.claude/skills`:

- **frontend-design**: diagnóstico de la UI anterior, las tres direcciones, el
  plan de tokens y su revisión frente a los rasgos de diseño generado
  (calibración de la skill).
- **emil-design-eng**: decisiones de movimiento y pulido. Para cada animación
  se decidió si debía existir, con qué propósito, qué curva y duración usar, y
  cómo se interrumpe. También `:active` con `scale(0.97)`, hover solo en
  dispositivos con puntero fino, y animar solo `transform`/`opacity`.
- **review-animations**: no se pudo ejecutar desde Claude Code porque la skill
  tiene `disable-model-invocation` y solo la puede lanzar el usuario con
  `/review-animations`. Queda pendiente; ver más abajo.

### Diagnóstico de la UI anterior

Capturas en `docs/screenshots/antes/`.

- Kit de tarjetas SaaS: tarjetas idénticas, una sola sombra y un solo radio,
  botón con degradado morado y acento índigo.
- Rótulos en mayúsculas sobre cada bloque, metadatos unidos con puntos medios y
  el modelo en una monoespaciada desproporcionada.
- Agentes distinguidos solo por una letra (O/D/T).
- Tablero de cinco columnas casi siempre con cuatro vacías; la columna útil
  era estrecha y recortaba el informe de Testing.
- Un titular de marketing ocupaba el lugar del progreso real.
- Tipografía Geist, la predeterminada del scaffold.

### Direcciones propuestas

1. **Sala de control**: pizarra, tipografía de rotulación y tareas que avanzan
   por estaciones.
2. **Cuaderno de laboratorio**: columna editorial con anotaciones al margen.
3. **Terminal moderna**: paneles monoespaciados al estilo tmux.

Se recomendó la 1 porque el producto es un pipeline con estados, y el usuario
la eligió.

### Decisiones de diseño

- **Tokens en un solo sitio** (`app/tokens.css`): superficies, tinta, color por
  agente (relleno, texto seguro y tinte), tipografía, escala de espaciado de
  4 px, radios jerárquicos (4 px para controles, 8 px para paneles y redondo
  solo para lámparas), dos sombras mínimas, y duraciones y curvas
  (`--ease-out` y `--ease-in-out` personalizadas).
- **Color = quién, forma = estado**:
  - Orquestador ocre, Develop cobalto, Testing verde azulado.
  - Lámpara rellena = hecho, latiendo = trabajando, anillo discontinuo = en
    espera, rombo rojo = error.
  - Así el verde de Testing no se confunde con «éxito», y el estado no depende
    solo del color.
- **Iconos SVG propios** (`components/agent-identity.tsx`), sin emojis:
  Orquestador, rama que se divide; Develop, corchetes; Testing, escudo con
  verificación; Hecha, bandera. Se repiten en estaciones, fichas y registro.
- **Tipografía**: Barlow Semi Condensed, de rotulación y con cifras tabulares,
  para títulos. Barlow para el texto. JetBrains Mono solo para código.
- **Estructura**:
  - La petición del usuario es el título de la ejecución.
  - La vía de cuatro estaciones sustituye a las tarjetas y al tablero.
  - Cada tarea es una ficha que avanza y retrocede cuando Testing la rechaza.
  - Un trazo muestra el recorrido hecho.
  - Se eliminaron el titular de marketing y el panel «Cómo funciona».
- **Sin clichés**: ni degradados, ni rótulos en mayúsculas, ni puntos medios
  como separadores, ni flechas en los botones, ni tarjetas idénticas en
  rejilla. Los eventos de proveedor se redactan a partir de sus metadatos («Gemini
  (gemini-3.5-flash-lite) falló con HTTP 503 en 0,8 s»). El servidor también
  guarda el texto sin puntos medios; la lógica no cambia.
- **Movimiento**, solo sobre `transform`/`opacity`:
  - Ficha: transición CSS de 280 ms con `--ease-in-out`. Se comprobó en el
    navegador que se interrumpe y redirige a mitad de camino sin saltos.
  - Trazo de recorrido: `scaleX`.
  - «Pensando»: anillo que late en la lámpara y en la ficha activa.
  - Eventos nuevos: 160 ms con `@starting-style`, solo los que llegan con la
    página abierta (el historial inicial no se anima).
  - Estación activa: barra superior con `scaleX`.
  - Con `prefers-reduced-motion` se quitan los desplazamientos y los latidos;
    se conservan color y opacidad. Verificado emulando la preferencia.
- **Microinteracciones**:
  - `:active` con `scale(0.97)` y hover solo con `(hover: hover) and
    (pointer: fine)`.
  - Foco visible de 2 px en todos los controles y enlace «Saltar al
    contenido».
  - Ctrl + Enter para enviar.
  - Skeletons al cargar una ejecución y estados vacíos que dicen qué aparecerá
    y cómo empezar.
- **Accesibilidad**:
  - Un script calculó el contraste: todo el texto cumple AA en ambos temas.
    El ocre de relleno y un nuevo token de borde de control se ajustaron para
    llegar a 3:1.
  - Recorrido con Tab en orden lógico y foco visible en todos los elementos.
  - Tema aplicado antes del primer pintado, según la guía oficial de Next.js
    16 «Preventing flash before hydration», consultada con Context7.
  - Sin scroll horizontal a 390 px.

### Archivos

- Nuevos: `app/tokens.css`, `components/agent-identity.tsx` y
  `components/run-track.tsx`.
- Reescritos: `app/globals.css` y `app/layout.tsx` (fuentes y script de tema).
- Reestructurados: el render de `components/dashboard.tsx` (estado, sesión,
  Realtime y avance de pasos sin cambios), `event-timeline.tsx` y
  `code-viewer.tsx`.
- Eliminados: `agent-cards.tsx` y `task-board.tsx`.
- `lib/dashboard/presentation.ts` y su test no cambian.

### Verificación

- Ejecución real 3 de 10 del día («Paleta CSS accesible»): completada en 14 s
  (Gemini 503 → Groq en los tres pasos). Se usó para comprobar en vivo el
  estado «trabajando».
- 40 tests, TypeScript, lint y build pasan. Con una carga limpia, la consola no
  muestra errores ni avisos.
- Capturas en `docs/screenshots/despues/`:
  - Escritorio y móvil, en claro y en oscuro.
  - Ejecución en curso.
  - Informe de Testing desplegado, que ya no se recorta.
  - Las de `docs/screenshots/antes/` son de la misma ejecución, para
    comparar.

### Pendiente

- Que el usuario ejecute `/review-animations` sobre el resultado. Lo que
  encuentre se aplicará en un commit aparte.
- La ficha no se ha visto desplazarse en una run real, porque los pasos
  duraron menos de lo que tarda en actualizarse la captura. Su movimiento se
  verificó cambiando `--stop` en el navegador.

### Ajuste tras revisión del usuario

El usuario compartió una captura de su navegador. En escritorio, las paradas
de la vía y la ficha «Hecha» quedaban centradas en cada columna, mientras que
los iconos de las estaciones estaban alineados a la izquierda: la ficha quedaba
unos 130 px a la derecha de su estación. Ahora, a partir de 760 px, cada parada
cae bajo el icono de su estación y la ficha empieza alineada con él. Medido: las
paradas quedan en 76/411/747/1082 px y los iconos en 76/412/748/1083 px. En
móvil se mantiene centrado. La franja oscura a la derecha de la captura queda
fuera de la página: es espacio del navegador.

El `next dev` heredado en el puerto 3000 dejó de recoger cambios de CSS. Se
verificó con `next build` + `next start` en el puerto 3100, sin tocar ese
proceso. Para ver el cambio en :3000 hay que reiniciar ese servidor.

## Fase 3.5 — Cierre (2026-11-24)

Al retomar el proyecto se revisaron la bitácora, la arquitectura y el historial.
El rediseño estaba completo en `main`: la alineación de la vía (`539e22f`) y las
capturas de `docs/screenshots/despues/` ya estaban publicadas. El commit
`72f7892` («rediseño visual») solo añade skills de diseño en `.claude/skills`.
Sigue pendiente lo que solo puede hacer el usuario: lanzar
`/review-animations`. Los estados de error nuevos de la Fase 4 reutilizan los
tokens y el lenguaje visual del rediseño.

## Fase 4 — Calidad (2026-11-24)

### Petición

Errores claros en la UI (proveedor, cuota agotada, timeouts), estados vacíos y
de carga en todas las vistas, validación de longitud y contenido de la
petición, rate limiting por usuario para proteger la cuota gratuita y tests E2E
con Playwright del flujo principal usando un proveedor simulado. Al terminar:
tests, lint, TypeScript y build en verde, commit, push y bitácora.

### Documentación consultada (Context7)

- AI SDK, «Testing»: `MockLanguageModelV4` de `ai/test` con
  `generateText` + `Output.object`. Se comprobó en `node_modules` que la versión
  instalada (`ai` 7.0.179) exporta esa clase y que `ai/test` no depende de
  Vitest, así que puede usarse en el servidor.
- Playwright 1.65, `webServer`: `command`, `url`, `env`, `timeout` y
  `reuseExistingServer`.

### Decisiones

- **Errores con código estable.** Las rutas devuelven
  `{ code, error, detail, retryAfterSeconds? }` en español y `Retry-After`. Un
  único catálogo (`lib/errors/user-messages.ts`), compartido por cliente y
  servidor, decide el título, la explicación y la acción. Los fallos de un run
  se explican a partir del `errorCode` de sus eventos, no del texto en inglés
  guardado para auditoría. Esos textos siguen en inglés en la BD; la UI los
  traduce para los eventos de fallo y reintento.
- **Navegador resiliente.** Timeouts de `fetch` (75 s por paso, mayor que el
  `maxDuration` de 60 s; 20 s al crear), hasta dos reintentos silenciosos ante
  5xx o cortes de red (los pasos son idempotentes) y espera automática ante el
  límite por minuto.
- **Validación.** De 10 a 2000 caracteres. Se bajó de 4000 porque la petición
  se repite en cada prompt de los tres agentes. Se rechazan caracteres de
  control, texto sin palabras y credenciales reconocibles. Cuerpo JSON de
  16 KiB como máximo. El mismo módulo valida en el navegador y en el servidor.
- **Rate limiting sin migración.** Se cuenta en Postgres desde la ruta con el
  cliente de servicio, usando ventanas deslizantes y límites configurables
  (`RATE_LIMIT_*`):
  - Runs: 5 por usuario y hora, 15 por usuario y día, 150 globales al día.
  - Pasos con modelo: 10 por usuario y minuto, 200 por usuario y día.

  Si el conteo falla, la ruta responde 503 en lugar de dejar pasar. El límite
  global es el que acota la creación masiva de sesiones anónimas. Contar y
  luego insertar no es atómico: queda documentado.
- **Proveedor simulado.** `AI_PROVIDER=mock` sustituye la cadena por un modelo
  determinista. Se niega a funcionar con `VERCEL_ENV=production`. Los
  marcadores `[simular:…]` reproducen cuota, caída, timeout, salida mal
  formada y una iteración rechazada por Testing.
- **E2E contra build de producción.** `next build` + `next start` en el puerto
  3200 con el mock, sin reutilizar nunca un servidor existente, para no gastar
  cuota real por error.

### Hallazgos y correcciones durante la fase

- **Vitest no arrancaba en este entorno.** Las 8 suites existentes fallaban
  antes de mis cambios con `Cannot read properties of undefined (reading
  'config')`. Causa: el terminal estaba en `d:\` en minúscula y Vitest cargaba
  su runner dos veces. Se confirmó comparando `cmd` en `d:\` (falla) con `D:\`
  (pasa). `npm test` arranca ahora mediante `scripts/vitest.mjs`, que normaliza
  la letra de unidad.
- **Se perdían los eventos más recientes.** El timeline pedía los eventos en
  orden ascendente con `limit(250)`, así que en runs largos se quedaba con los
  250 más antiguos. Ahora pide los 250 más recientes y los invierte.
- **El paso final quedaba bloqueado.** Al capturar las pantallas, el límite de
  10 pasos por minuto bloqueaba el claim que solo marca el run como
  completado, que no llama a ningún modelo. La ejecución se quedaba «En
  ejecución» con 2 de 2 tareas durante 46 s. Ahora ese paso nunca se limita y
  el test de rate limit bajó de 1 min a 16 s.
- **Build roto por `Date.now()`.** Next 16 abortaba el prerender por un
  `Date.now()` en el `useState` inicial. El reloj de la cuenta atrás se fija
  ahora desde un efecto.
- **Estados vacíos según el estado del run.** Se distinguen «sin ejecución»,
  «en curso» y «se detuvo antes de…» en la vía, el registro y el visor. Hay un
  estado de error con «Reintentar carga» cuando falla la carga inicial de una
  ejecución, que antes dejaba los skeletons para siempre. «Sin plan» aparece si
  el run falló.

### Archivos

- Nuevos:
  - `lib/validation/run-request.ts`
  - `lib/errors/user-messages.ts`
  - `lib/http/api-error.ts`
  - `lib/rate-limit/policy.ts` y `lib/rate-limit/check.ts`
  - `lib/ai/mock-model.ts` y `lib/ai/provider-label.ts`
  - `components/notice.tsx`
  - `e2e/` y `playwright.config.ts`
  - `scripts/vitest.mjs`
  - Tests de los módulos nuevos.
- Modificados:
  - Ambas rutas de la API.
  - `dashboard.tsx`, `run-track.tsx`, `event-timeline.tsx` y `code-viewer.tsx`.
  - `presentation.ts`, `model-config.ts`, `model.ts` y `provider-attempt.ts`.
  - `globals.css` (estilos de aviso y de campo inválido).
  - `.env.example`, README y ARQUITECTURA.
- Eliminado: `CreateRunSchema`, sustituido por el validador compartido.
- Sin migraciones nuevas.

### Verificación

- `npm test`: 12 ficheros y 76 tests pasan.
- `npx tsc --noEmit` y `npm run lint`: sin errores ni avisos.
- `npm run build`: correcto. Lo ejecuta el `webServer` de Playwright.
- `npm run test:e2e` (Playwright, Chromium, build de producción con el mock): 7 tests pasan, más 3 de capturas con `E2E_SCREENSHOTS=1` (10 de 10 en 1,8 min): flujo principal, iteración Develop↔Testing, validación en cliente y en servidor (400/413/415), cuota agotada con reintento automático, salida mal formada y límite diario.
- Capturas en `docs/screenshots/fase4/`:
  - Validación en línea.
  - Ejecución en curso y completada (claro).
  - Reintento automático y cuota agotada (oscuro).
  - Límite diario en móvil a 390 px, sin scroll horizontal (comprobado en el
    test).
- Ninguna ejecución real con Gemini o Groq en esta fase: todo con el proveedor
  simulado (0 de 10 del cupo diario).

### Limitaciones

- Los E2E usan el proyecto Supabase real: cada ejecución crea usuarios
  anónimos y runs de prueba. No hay entorno Supabase desechable (el usuario
  pidió no usar Docker ni Supabase local).
- No hay límite por IP. Un atacante puede crear muchas sesiones anónimas hasta
  alcanzar el límite global diario.
- Los resúmenes de eventos que no son de error («Create an ordered task
  plan.», «A new agent run was created.») siguen en inglés, porque los escriben
  las RPC.
- `npx playwright install chromium` actualizó los navegadores a la build 1255 y
  retiró la 1228.
