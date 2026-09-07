# Day by Day

App de gastos compartidos y planning de mudanza a Nueva Zelanda, para un grupo
chico de personas.

Está en producción en **[daybyday-nz.netlify.app](https://daybyday-nz.netlify.app)** y se instala en el celular como app (Android: menú ⋮ → *Instalar app*; iPhone: compartir → *Agregar a pantalla de inicio*).

## Qué hace

**Hoy** — la pantalla de entrada: el saldo actual, las tareas atrasadas y las de esta semana, y los últimos gastos.

**Plan** — el checklist de la mudanza. Se siembra solo con 34 tareas (visa, IRD, seguro médico, tenancy, cierre fiscal…) calculadas a partir de la fecha de llegada, repartidas en 8 fases del viaje. Tablero tipo Kanban con tres estados, o vista de calendario mensual. Cada tarea puede mandarse a Google Calendar con un toque.

**Gastos** — carga rápida en tres toques (monto, rubro, quién pagó). Soporta NZD, USD, AUD y ARS con tipos de cambio fijos editables, reparto en partes iguales / por monto exacto / propio, y funciona sin señal: el gasto se guarda local y se sincroniza cuando vuelve la conexión.

Para sumar a alguien: **Resumen → Invitar**, con su mail y el nombre que va a aparecer en los gastos. No se manda ningún mail desde la app — le pasás el link vos, y cuando entra con ese mismo mail queda dentro del grupo sola.

**Resumen** — gasto por rubro en barras, tabla de quién gastó cuánto en cada rubro, y el saldo con cada uno. Por mes, por año o histórico completo.

Los datos se sincronizan en vivo entre los teléfonos del grupo vía Supabase Realtime.

## Stack

- **Vite + React 19**, sin router ni librerías de UI — la navegación es estado local y los estilos son CSS a mano.
- **Supabase** para datos y auth (login por magic link).
- **Netlify** para el hosting.

Las únicas dependencias de producción son `react`, `react-dom` y `@supabase/supabase-js`.

## Correrlo local

```bash
npm install
cp .env.example .env    # completar con las claves del proyecto de Supabase
npm run dev
```

Variables necesarias en `.env`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Otros comandos: `npm run build` (compila a `dist/`), `npm run lint`.

## Base de datos

El esquema vive en `supabase/migrations/`. Las migraciones **no se aplican solas**: hay que pegarlas en el SQL Editor de Supabase y ejecutarlas en orden.

`0001_esquema_base.sql` reconstruye las tablas que se habían creado a mano al principio del proyecto; en una base que ya viene andando no hace falta correrlo.

| Tabla | Para qué |
|---|---|
| `miembros` | quién pertenece a qué grupo, con su alias |
| `invitaciones` | permisos esperando: quién puede sumarse al grupo y con qué alias |
| `grupos` | la fecha de llegada, que define todo el cronograma |
| `plan_tareas` | las tareas del plan: fase, prioridad, estado, fecha |
| `gastos` / `pagos` | los gastos y los saldados entre los miembros |

Todas las tablas usan Row Level Security con el mismo criterio: solo ves las filas del grupo al que pertenecés.

El reparto es parejo entre todos los miembros: `gastos.deuda` guarda lo que le debe **cada uno** de los otros al que pagó, y la vista `saldos_por_par` netea eso contra los pagos para decir quién le debe a quién. Sumar miembros al grupo cambia el reparto de los gastos que se carguen desde ese momento; para recalcular los viejos hay que volver a correr el `update gastos set monto = monto` de la migración 0010.

## Deploy

```bash
npm run build
npx netlify-cli deploy --prod
```

Las variables de entorno se configuran en el dashboard de Netlify. Ojo con un detalle de Supabase Auth: el dominio de producción tiene que estar en **Authentication → URL Configuration → Redirect URLs**, si no el magic link no vuelve a la app.

## Estructura

```
src/
  App.jsx              shell: sesión, contexto del grupo, pestaña activa
  components/
    TabBar.jsx         navegación inferior
    TarjetaTarea.jsx   tarjeta de tarea (compartida por Plan y Calendario)
    NuevoGasto.jsx     alta y edición de gastos
    NuevaTarea.jsx     alta de tareas
    tabs/              una pantalla por pestaña
  lib/
    supabase           cliente único
    gastos             datos de gastos, rubros, tasas y cola offline
    tareas.js          datos del plan, fases y la semilla de 34 tareas
    formato.js         formato de plata y fechas
```

Los colores de rubro (`RUBROS` en `src/lib/gastos`) están validados para contraste y daltonismo — si se cambian o reordenan, hay que volver a validarlos.
