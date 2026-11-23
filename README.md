# Equipo de agentes IA

Aplicación Next.js para coordinar un Orquestador, Develop y Testing. El estado
del workflow, los eventos y los artefactos virtuales se persisten en Supabase.
Consulta [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para el diseño y sus límites.

> Estado: las fases 0–2 están completas y la interfaz de la Fase 3 está en
> desarrollo local. Todavía no hay una URL pública desplegada.

## Requisitos

- Node.js 20.9 o posterior y npm.
- Acceso a un proyecto Supabase existente.

## Desarrollo

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Configura en `.env.local` la URL y la clave publicable del proyecto según
`.env.example`. No guardes claves reales en Git; `.env.local` está excluido en
`.gitignore`. La clave de servidor `SUPABASE_SERVICE_ROLE_KEY` nunca debe llevar
el prefijo `NEXT_PUBLIC_` ni usarse desde el navegador.

Antes de habilitar el flujo de la aplicación, activa **Anonymous Sign-Ins** en
la configuración de Auth del proyecto Supabase. Esta opción no se cambia
mediante una migración SQL.

Las llamadas usan Vercel AI SDK y una cadena de proveedores configurada por
entorno. Por defecto, `GEMINI_MODEL=gemini-3.5-flash-lite` es el modelo
principal y `GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite` el alternativo. Ambos
admiten structured output y sus páginas oficiales muestran nivel gratuito
estándar; disponibilidad, cuotas y tratamiento de datos pueden cambiar. Google
indica que puede usar datos del nivel gratuito para mejorar productos: no envíes
información sensible. Consulta [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite),
[Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
y [precios](https://ai.google.dev/gemini-api/docs/pricing).

Si `GROQ_API_KEY` está configurada, el siguiente fallback es
`GROQ_MODEL=openai/gpt-oss-20b`; Groq documenta strict structured outputs para
ese modelo. El usuario confirmó que su cuenta Groq Free no tiene método de pago
y que, al superar la cuota, devuelve HTTP 429; esta garantía depende de la cuenta
concreta. La documentación de Groq publica precios para uso de pago y límites
exactos por organización, así que configura aquí solo una cuenta Free sin método
de pago. Consulta [Structured Outputs](https://console.groq.com/docs/structured-outputs),
[modelos](https://console.groq.com/docs/models) y
[rate limits](https://console.groq.com/docs/rate-limits).

`AI_PROVIDER=google` (predeterminado) ordena Gemini principal → Gemini
alternativo → Groq opcional; con `AI_PROVIDER=groq`, Groq va primero. Ante un
error transitorio (timeout o HTTP 408/425/429/500/502/503/504) la misma
invocación pasa enseguida al siguiente proveedor. Solo si fallan todos se
programa un reintento persistido con backoff exponencial y jitter (máximo
cuatro por paso). Timeouts: 25 s Gemini, 30 s Groq, acotados a un presupuesto
de 45 s por invocación (`maxDuration` 60 s); el SDK no reintenta por su cuenta.
Los eventos registran proveedor, modelo, resultado y duración. Cambia
`GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` y `GROQ_MODEL` sin modificar código;
`AI_MODEL` solo se acepta como fallback heredado de `GROQ_MODEL` cuando
`AI_PROVIDER=groq`, para que un nombre Gemini antiguo no contamine el fallback.

La migración `20261124160000_allow_groq_fallback_retry.sql` amplía el límite
persistido a cuatro intentos. Tras revisar una migración nueva, aplícala
explícitamente al proyecto enlazado con `npx supabase db push --remote`.

Para diagnosticar Gemini localmente, ejecuta `node scripts/diagnose-gemini.ts`.
El script carga `.env.local` sin imprimir claves, lista los modelos accesibles y
hace una llamada mínima de texto y otra con el esquema del Orquestador. Las
pruebas de generación consumen cuota; ejecútalo solo cuando sea necesario.

La aplicación inicia una sesión anónima de Supabase en el navegador; los runs,
las tareas, los informes y los archivos virtuales quedan asociados a esa sesión.
La interfaz muestra las actualizaciones de Postgres Realtime y puede reanudar
pasos guardados. Los archivos generados son artefactos virtuales; no se ejecutan
en el servidor.

Para enlazar otro proyecto y aplicar las migraciones versionadas:

```powershell
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --remote
```

Las comprobaciones de esquema disponibles contra el proyecto enlazado son:

```powershell
npx supabase migration list --remote
npx supabase db lint --remote --schema public --fail-on error
```

La CLI puede necesitar la contraseña de base de datos configurada de forma
segura en el entorno como `SUPABASE_DB_PASSWORD`; no la incluyas en Git ni la
compartas.

`supabase/tests/rls.test.sql` contiene pruebas para un entorno de pruebas
desechable. No se ejecutan contra producción.

## Comprobaciones

```powershell
npm run lint
npm test
npm run build
```

## Fases y documentación

- [Bitácora](docs/BITACORA.md): peticiones, decisiones y resultados por fase.
- [Arquitectura](docs/ARQUITECTURA.md): diseño técnico y estado de las decisiones.
- `CLAUDE.md`: convenciones para trabajar con Claude Code.
