# Equipo de agentes IA

Aplicación Next.js para coordinar un Orquestador, Develop y Testing. El estado
del workflow, los eventos y los artefactos virtuales se persisten en Supabase.
Consulta [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para el diseño y sus límites.

> Estado: base y núcleo de agentes implementados. La interfaz se completará en
> Fase 3; los endpoints requieren una sesión Supabase válida.

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

Para las llamadas a modelos, `.env.example` configura Google Gemini 4 Hydrogen
con la API key de Google AI Studio. La documentación de Google indica que ese
modelo está disponible en el nivel gratuito estándar al redactar esta guía; los
modelos y cuotas pueden cambiar. El nivel gratuito puede usar las solicitudes
para mejorar los productos de Google, así que no envíes datos sensibles.
`AI_PROVIDER=groq` permite cambiar a Groq con un modelo y key compatibles. No se
configura fallback automático a un proveedor de pago.

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
