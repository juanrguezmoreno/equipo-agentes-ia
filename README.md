# Equipo de agentes IA

Aplicación Next.js para coordinar un Orquestador, Develop y Testing. El estado
del workflow, los eventos y los artefactos virtuales se persisten en Supabase.
Consulta [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para el diseño y sus límites.

> Estado: base técnica en construcción. Las funciones de agentes y la interfaz
> final se completarán en las siguientes fases.

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

`supabase/tests/rls.test.sql` contiene pruebas para un entorno de pruebas
desechable. No se ejecutan contra producción.

## Comprobaciones

```powershell
npm run lint
npm run build
```

## Fases y documentación

- [Bitácora](docs/BITACORA.md): peticiones, decisiones y resultados por fase.
- [Arquitectura](docs/ARQUITECTURA.md): diseño técnico y estado de las decisiones.
- `CLAUDE.md`: convenciones para trabajar con Claude Code.
