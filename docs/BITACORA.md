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
