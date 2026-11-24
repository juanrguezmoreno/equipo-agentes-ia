# Cómo se construyó: proceso con Claude Code

Este documento cuenta cómo se hizo el proyecto, fase a fase, a partir de
[BITACORA.md](BITACORA.md) y del historial de git. Cuando algo no consta en
ninguno de los dos, se dice explícitamente en lugar de suponerlo.

## Resumen

- **Calendario.** El proyecto se hizo en dos días, el 23 y el 24-11-2026, con
  commits pequeños sobre `main`.
- **Herramientas.**
  - Fases 0 a 3: GitHub Copilot en modo agente.
  - Desde la corrección del fallback de proveedores en la Fase 3 hasta la
    Fase 6: Claude Code, la herramienta requerida para el proyecto.
- **Método.** Fases cortas con parada para aprobación, una bitácora viva y
  verificación con tests y ejecuciones reales antes de cerrar cada fase.

## Reglas de trabajo

[CLAUDE.md](../CLAUDE.md) fija las convenciones que se siguieron en todas las
fases:

- Trabajar en la fase aprobada y **parar en cada frontera de fase** con un
  resumen para aprobación.
- Consultar la documentación oficial actual antes de implementar y no inventar
  APIs.
- TypeScript estricto. **Toda salida de un modelo se valida con Zod** como
  entrada no confiable.
- Invocaciones serverless cortas, acotadas y seguras de reintentar, con el
  estado persistido antes de responder.
- Eventos auditables, sin secretos.
- Comprobaciones deterministas y revisión del modelo antes de dar una tarea por
  completada.
- Secretos solo en `.env.local` y en los paneles; `.env.example` documentado.
- Hasta **10 ejecuciones reales al día** con modelos gratuitos verificados,
  inspeccionando los logs entre una y otra y sin repetir a ciegas.

## Fases

| Fase | Commits | Herramienta | Resultado |
| --- | --- | --- | --- |
| 0 — Plan | `c26d8bd` | Copilot | Arquitectura propuesta y `CLAUDE.md` |
| 1 — Base | `fc8f43a` a `725c6f0` | Copilot | Scaffold Next.js, esquema Supabase con RLS y migraciones remotas |
| 2 — Agentes y estados | `5645fd4`, `13db2ed` | Copilot | Contratos Zod, máquina de estados, RPC transaccionales y tests con modelo simulado |
| 3 — Interfaz | `0de7ae4` (WIP) | Copilot | Panel, Realtime y primeros fallos con Gemini |
| 3 — Corrección | `b95ae85`, `a023c26` | **Claude Code** | Cadena de proveedores en una sola invocación; primeros ciclos completos reales |
| 3.5 — Rediseño | `5bda69d` a `539e22f` | Claude Code | Dirección «Sala de control», tokens, movimiento y accesibilidad AA |
| 4 — Calidad | `5ca0bf2` a `a462a85` | Claude Code | Errores claros, validación, rate limiting y E2E con proveedor simulado |
| Revisión de animaciones | `b2036a4` a `fff98e8` | Claude Code | Arreglos de movimiento y E2E con una sola sesión anónima |
| 5 — Despliegue | `2ce1c30` a `14b19f6` | Claude Code | Vercel, checks de Next.js y a11y, idioma, planes de 2–4 tareas, 6 ejecuciones reales |
| 5.5 — Arreglos de agentes | `753783d`, `2c6716a` | Claude Code | Alcance de Develop, barrera de reenvíos y 3 ejecuciones reales |
| 6 — Documentación | último commit de la Fase 6 | Claude Code | README, arquitectura, este documento y revisión de secretos |

### Fases 0–3 con GitHub Copilot

Las fases 0 a 3, hasta el commit `0de7ae4`, se desarrollaron con GitHub Copilot
en modo agente. Los commits `c26d8bd` a `13db2ed` llevan el trailer
`Co-authored-by: Copilot`, y `0de7ae4` es un commit WIP del usuario sin
trailer. Al detectarlo, el desarrollo continuó con Claude Code, la herramienta
requerida. Claude Code revisó el estado del proyecto y completó las fases 3 a
6.

Lo que dejó esa etapa:

- La arquitectura de pasos cortos e idempotentes con RPC en Postgres, que se
  mantuvo hasta el final.
- Migraciones aplicadas por el usuario con la CLI de Supabase sobre el
  proyecto remoto. El usuario pidió explícitamente no usar Docker ni Supabase
  local, después de un `supabase start` fallido.
- Los primeros problemas con Gemini, analizados en «Problemas reales».

Al revisar el estado del proyecto, Claude Code no volvió a verificar cada
afirmación de las entradas de la bitácora de esa etapa. Sí comprobó que el
árbol de trabajo estaba limpio, que `0de7ae4` estaba en `origin/main` y que
pasaban los tests, TypeScript y lint. Algunas fechas de esas entradas (24 y
26-11) no coinciden con git, donde todo es del 23-11; las fechas de referencia
son las de git.

### Desde la Fase 3 con Claude Code

El primer trabajo con Claude Code (`b95ae85`) fue corregir la causa de que
ningún ciclo se completara. Cada invocación probaba un único proveedor, así
que un 503 de Gemini gastaba un reintento persistido y un backoff antes de
probar el siguiente. Ahora la cadena completa se recorre dentro de la misma
invocación. Ese mismo día se completaron las dos primeras ejecuciones reales
(`a023c26`).

## Herramientas

### MCP

- **Context7.** Se usó para la documentación de librerías antes de
  implementar:
  - `timeout` de `generateText` en el AI SDK (Fase 3);
  - «Preventing flash before hydration» de Next.js 16 (Fase 3.5);
  - `MockLanguageModelV4` del AI SDK y `webServer` de Playwright (Fase 4);
  - autenticación con proyecto `setup` y `storageState`, y `routeWebSocket`,
    de Playwright (arreglo de los E2E).

  En la etapa de Copilot no estaba disponible.
- **Vercel.** En la Fase 5:
  - Hubo que autorizar el acceso al equipo (`authorize_team_access`; el
    usuario aprobó el enlace).
  - Con él se revisaron los despliegues, los logs de build, los errores y logs
    de ejecución, y los **nombres** de las variables de entorno, sin descifrar
    valores.
  - En adelante se usó para confirmar que cada commit estaba en READY antes
    de cada ejecución real.
- **Playwright.** En la Fase 3, Claude Code lanzó las ejecuciones reales y las
  capturas contra `next dev` con Playwright. En ese mismo commit (`a023c26`)
  el `.gitignore` recibió `/.playwright-mcp/`, la carpeta de artefactos de
  sesión del MCP de Playwright, lo que indica que se usó el MCP. La bitácora no
  lo nombra expresamente. Desde la Fase 4 se usó **Playwright Test** (la
  librería):
  - la batería E2E;
  - `scripts/prod-run.mjs` para las ejecuciones en producción;
  - un script puntual para grabar el GIF.
- **Supabase.** Ni la bitácora ni git dejan constancia de que se usara el MCP
  de Supabase.
  - En la etapa de Copilot no estaba disponible y se usó la CLI (`db push`,
    `migration list`, `db lint`, `db query --read-only`).
  - En la Fase 3 con Claude Code, la bitácora menciona «consultas read-only» a
    runs y eventos sin indicar la herramienta.
  - En las sesiones de las Fases 4 a 6 ese MCP no estaba conectado.
  - Las migraciones las aplicó siempre el usuario.

### Skills

- **frontend-design.** Fase 3.5: diagnóstico de la UI anterior, tres
  direcciones visuales, plan de tokens y revisión frente a los rasgos de diseño
  generado.
- **emil-design-eng.** Fase 3.5: decisiones de movimiento y pulido. Para cada
  animación se decidió si existir, curva y duración, cómo se interrumpe,
  `scale(0.97)` al pulsar, hover solo con puntero fino, y solo
  `transform`/`opacity`.
- **review-animations.** Claude Code no podía invocarla
  (`disable-model-invocation`), así que quedó pendiente en la Fase 3.5. El
  usuario la lanzó con `/review-animations` y pidió aplicar lo de prioridad
  alta y media:
  - **Alta:** el historial del registro entraba entero animado.
  - **Media:** avisos sin entrada; una variable CSS del padre movía hijos.
  - Lo de prioridad baja quedó anotado.
- El usuario versionó las skills instaladas en `.claude/skills` con su commit
  `72f7892`.

### Subagentes

La bitácora no registra uso de subagentes, y en las sesiones de las Fases 4 a
6 no se lanzó ninguno. Todo el trabajo se hizo en la conversación principal.

## Ejemplos de prompts reales

Fragmentos literales de peticiones del usuario:

> **Fase 4 — Calidad:** «Rate limiting por usuario para proteger la cuota de
> los modelos gratuitos. Tests end-to-end con Playwright del flujo principal
> (crear petición → ver agentes trabajando → tarea completada), con el
> proveedor simulado para que no gasten cuota.»

> **Arreglo de los E2E:** «el límite se agota porque cada test E2E crea una
> sesión anónima nueva. […] Usa un global setup de Playwright que inicie sesión
> anónima UNA sola vez y guarde el storageState […] No cambies el rate limit de
> Supabase: es la mitigación de seguridad que acordamos.»

> **Fase 5 — Mejoras detectadas en la prueba real:** «Testing demasiado
> permisivo: aprobó src/pages/Contact.tsx con useState sin 'use client'.
> Añade comprobaciones deterministas de convenciones de Next.js App Router […]
> Así el bucle Develop↔Testing aparecerá de forma natural cuando haya fallos
> reales.»

> **Fase 5.5:** «Reenvíos idénticos: compara el contenido (hash) con la
> revisión anterior; si Develop reenvía lo mismo tras un rechazo, no lo mandes
> a Testing: devuélveselo con un aviso explícito y el informe de fallos de
> Testing, y que cuente como iteración.»

## Decisiones y correcciones del usuario

- **Proceso.** Por fases, parando para aprobación y con push al cerrar cada
  una.
- **Entorno.** Nada de Docker ni Supabase local. Las migraciones se preparan
  en el repositorio y las aplica el usuario. Nadie lee `.env.local`: solo se
  comprueba que las variables existen.
- **Coste.**
  - Cadena Gemini principal → Gemini alternativo → Groq, con Groq solo en una
    cuenta Free sin método de pago.
  - Regla de 10 ejecuciones reales al día. Cuando se encontraron 11 de
    sesiones anteriores, el usuario decidió que no contaban.
- **Diseño.** Eligió la dirección «Sala de control» entre tres propuestas. Con
  una captura de su navegador detectó que las paradas de la vía no caían bajo
  sus iconos (`539e22f`).
- **Seguridad.**
  - Configuró 30 inicios de sesión anónimos por IP y hora en Supabase y
    prohibió relajarlo para los tests.
  - Borró `AI_MODEL` en Vercel y apuntó la Site URL de Supabase a
    producción.
- **Calidad de los agentes**, a partir de su propia prueba en producción:
  - que respondieran en el idioma de la petición;
  - un Testing más estricto con convenciones de Next.js y de accesibilidad;
  - planes de 2–4 tareas;
  - el registro nombrado por tarea;
  - más adelante, el alcance de Develop y la detección de reenvíos por hash.

## Problemas reales

### Gemini: 503, 400 y la cadena de respaldo

- **503 constantes.** En la etapa de Copilot, cinco ejecuciones reales no
  completaron el flujo: timeouts y respuestas HTTP 503 de Gemini.
- **400 por el esquema.** Un script de diagnóstico (`scripts/diagnose-gemini.ts`)
  mostró que Gemini rechazaba el esquema del plan por su complejidad (arrays
  acotados, longitudes, regex). Desde entonces se envían esquemas simples al
  proveedor y se revalida con los completos en el servidor.
- **Respaldo mal configurado.** El primer intento con Groq dio 404 porque el
  alias `AI_MODEL` contenía un nombre de modelo de Gemini. Después Zod
  rechazó rutas y dependencias generadas por Groq, y se precisó el prompt.
- **Restricción de la base de datos.** Al guardar el primer plan saltó un
  error `23514`: la restricción de `acceptance_criteria` esperaba un array. Lo
  resolvió una migración.
- **Cadena dentro de la invocación.** Con Claude Code, la cadena se recorre en
  una sola invocación, con timeouts de 25 s para Gemini y 30 s para Groq,
  acotados a un presupuesto de 45 s.
- **Sigue siendo imprescindible.** En casi todas las ejecuciones reales
  posteriores aparece algún 503 o timeout de Gemini. En la ejecución 8 de
  producción, Groq respondió tras un 503 y un timeout de 25 s.

### Límite de sesiones anónimas en los E2E

- **Síntoma.** Durante la revisión de animaciones, los E2E empezaron a fallar
  al abrir la página: `POST /auth/v1/signup` devolvía 429 (confirmado en la
  traza de red). Cada test creaba un usuario anónimo, y varias tandas seguidas
  agotaron el límite por IP de Supabase.
- **Pruebas descartadas.** Dos «pruebas en rojo» de un arreglo fallaron por
  ese 429 y no por el bug que pretendían demostrar; se descartaron y se
  repitieron después.
- **Solución** (pedida por el usuario):
  - un proyecto `setup` que abre **una** sesión por tanda y la comparte con
    `storageState`;
  - un backend simulado en el navegador (API, PostgREST y Realtime) para los
    tests de UI de errores y límites;
  - tests unitarios de la lógica de rate limiting.
- **Lo que no se tocó:** el límite de Supabase.

### Testing demasiado permisivo

- **Detección.** El usuario lo vio en su prueba en producción: Testing aprobó
  `src/pages/Contact.tsx` con `useState` y sin `'use client'`.
- **Arreglo.** Comprobaciones deterministas sobre el AST, tanto de Next.js App
  Router como de accesibilidad (`lib/validation/conventions.ts`).
- **Efecto en producción.** En la ejecución 1, Testing bloqueó
  `app/contacto/page.tsx` por `nextjs:use-client` y Develop lo corrigió en la
  iteración siguiente, todo de forma natural.

### Otros problemas encontrados por el camino

- **Vitest no arrancaba.** Fallaban todas las suites cuando el terminal estaba
  en `d:\` en minúscula: el runner se cargaba dos veces. `scripts/vitest.mjs`
  normaliza la letra de unidad.
- **El registro perdía eventos.** Pedía los 250 más antiguos en vez de los más
  recientes.
- **Límite propio contra el último paso.** El límite de pasos por minuto
  bloqueaba el paso final, que no llama a ningún modelo: la ejecución quedaba
  46 s «En ejecución» con todas las tareas aprobadas.
- **Build roto.** `Date.now()` en un `useState` impedía el prerender de
  Next.js 16.
- **Plan incoherente** (ejecución real 4). Un check apuntaba a otra carpeta
  que el archivo de la tarea, así que Develop entregó tres veces un archivo
  correcto y la tarea falló. Se resolvió con mensajes de «el archivo no
  existe», reglas en el prompt y una reparación acotada del plan.
- **Desbordamiento en móvil.** 7 px de scroll horizontal a 390 px, porque una
  columna `auto` del grid crecía con el selector de archivos.
- **Revisión fuera de la tarea** (ejecución 8). La revisión de Testing marcó
  como crítico en la tarea del formulario algo que correspondía a la tarea de
  la página, y eso empujó a Develop a salirse de su alcance. El prompt de
  Testing ahora juzga solo la tarea en curso.
- **Iteración mal numerada.** Una migración antigua guarda mal la iteración
  de un rechazo en la penúltima iteración; la UI numera los informes por
  orden.

### Errores propios de Claude Code, corregidos

- Un primer límite de pasos que no distinguía el paso final, comentado arriba.
- Una suposición equivocada sobre el `stepKey`: daba la iteración por basada
  en 0. La primera ejecución real mostró «(iteración 2)» en el primer paso y
  se corrigió.
- **El diseño inicial de los E2E** creaba una sesión anónima por test. Fue
  la causa del 429.
- **Una captura de móvil no se pudo repetir.** La de la ejecución 2 (rechazo
  y corrección) tiene el desbordamiento de 7 px, que se arregló después. Esa
  sesión no se había guardado y ninguna ejecución posterior tuvo un rechazo
  natural en el momento de capturar. A partir de entonces el script guarda la
  sesión en el scratchpad.

## Verificación con ejecuciones reales

Uso de la regla de 10 ejecuciones reales al día:

- **23-11-2026:** 3 con Claude Code, contando desde la decisión de no
  computar las 11 anteriores.
- **24-11-2026:** 9 en producción.
  - **Fase 5 (1–6):** sirvieron para encontrar el plan de una sola tarea, el
    desbordamiento y el plan incoherente.
  - **Fase 5.5 (7–9):** la 8 ejerció de forma natural el alcance y la
    barrera de reenvíos, y la 9 se grabó para el GIF.

No se simuló ningún fallo en producción. Cuando no apareció un rechazo, se
dejó de gastar cupo en lugar de forzarlo.

## Lecciones aprendidas

1. **Tener la bitácora como fuente de verdad pagó.** Permitió retomar el
   trabajo al cambiar de herramienta tras las fases 0–3 y escribir este
   documento sin reconstruir de memoria.
2. **Primero lo determinista, luego el modelo.** Los checks deterministas
   fueron más fiables y baratos que la revisión del LLM, y hacen los rechazos
   explicables para Develop y para el usuario.
3. **Los modelos gratuitos fallan a menudo; hay que diseñar para ello.** La
   cadena de respaldo dentro de la invocación convirtió un sistema que nunca
   terminaba en uno que completa la mayoría de ejecuciones en 20–45 s.
4. **Las ejecuciones reales encuentran lo que los tests no ven.** El idioma,
   el plan de una sola tarea, el plan incoherente, el desbordamiento en móvil
   y la revisión fuera de la tarea solo aparecieron en producción. Cada uno
   acabó como test de regresión.
5. **Las pruebas no deben agotar los límites que protegen el sistema.** El
   arreglo correcto de los E2E fue usar menos sesiones y simular lo que no
   necesita backend real, no relajar el límite.
6. **Una prueba en rojo solo vale si falla por el motivo esperado.** Dos se
   descartaron porque fallaban por otro motivo (el 429).
7. **Cada cambio de comportamiento, con su test.** Los mensajes de error, los
   límites, las convenciones, el alcance y la barrera de reenvíos tienen tests
   unitarios o E2E que reproducen el caso real que los motivó.
