# Day by Day — notas para Claude

App de gastos compartidos y checklist de mudanza a Nueva Zelanda, para un
grupo chico de personas. En producción en https://daybyday-nz.netlify.app y se
instala en el celular como PWA.

**Este archivo existe para no redescubrir el repo en cada sesión.** Si algo
acá quedó viejo, corregilo en el momento: cuesta menos que volver a explorar.

## Adónde va

El día a día de Francisco y Eve: la previa de la mudanza acá y la vida allá
en Nueva Zelanda, seguido de verdad todos los días. Gastos, tareas y planning
en un solo lugar, y **conectado a Google Calendar como mínimo** — que una
tarea del plan aparezca en el calendario sin tener que cargarla dos veces.

La vara: **la usan desde el teléfono, todos los días.** Si algo agrega un paso
a cargar un gasto o a marcar una tarea, va en contra del producto por más
prolijo que quede el código.

## Dónde está cada cosa

```
src/App.jsx              el estado global y el ruteo, que es un useState
src/components/tabs/     las cuatro pantallas: Hoy, Planning, Gastos, Resumen
src/components/          el resto de la UI (Invitar.jsx: alta de invitaciones)
src/lib/gastos/          división, saldos y conversión de moneda
src/lib/supabase/        cliente, auth y realtime
src/lib/tareas.js        siembra las 34 tareas del plan desde la fecha de llegada
src/lib/csv.js           exportación
src/styles.css           TODOS los estilos, a mano
supabase/migrations/     el esquema SQL
```

## Comandos

```bash
npm install
cp .env.example .env    # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
npm test                # vitest
npm run lint
npm run build           # a dist/, que es lo que publica Netlify
```

**`npm run build` sin `.env` no verifica nada.** `src/lib/supabase` tira al
importarse si faltan las variables, el minificador constant-foldea ese throw y
elimina toda la app como código muerto: el build dice "✓ built", pero el bundle
sale en ~198 kB en vez de ~450 kB y no contiene una línea de la app. Si vas a
usar el build como chequeo, copiá `.env.example` a `.env` con valores
inventados — no hace falta que sean reales, solo que no estén vacíos. El CI ya
lo hace así (`.github/workflows/ci.yml` le pasa valores dummy al build), o sea
que esto es un problema del build local nada más: no hay nada que arreglar ahí.

## Lo que hay que saber antes de tocar

- **Las migraciones no se aplican solas.** Viven en `supabase/migrations/` y
  hay que pegarlas a mano en el SQL Editor de Supabase, en orden. Si agregás
  una columna, el código nuevo no anda hasta que alguien corra el SQL.
- **Todas las tablas tienen Row Level Security**: sólo ves las filas de tu
  grupo. Una consulta que "no devuelve nada" suele ser RLS, no un bug.
- **Los gastos funcionan sin señal**: se guardan local y se sincronizan al
  volver la conexión. Cualquier cambio en el alta de gastos tiene que
  sostener ese camino.
- **Los teléfonos del grupo se sincronizan en vivo** por Supabase Realtime. Un
  cambio de esquema afecta a todas las puntas a la vez.
- **El reparto es parejo entre todos los miembros.** `gastos.deuda` es lo que
  le debe CADA uno de los otros al que pagó, y lo calcula un trigger, no el
  cliente (migración 0010). La app lo recalcula igual para pintar la fila sin
  esperar a la red, pero el que vale es el del servidor.
- El login es por magic link. No hay contraseñas.
- **Tener cuenta y estar en el grupo son cosas distintas.** El magic link crea
  el usuario solo, pero la RLS filtra por `miembros`. Se entra al grupo por una
  invitación: `traerContexto` llama a `aceptar_invitacion()` cuando el usuario
  no tiene grupo, y esa función (security definer, migración 0011) le crea la
  fila en `miembros` si hay una invitación pendiente para su mail. La app no
  manda mails: la invitación es el permiso esperando.

## Convenciones

- **Todo en castellano**: variables, componentes, comentarios, commits.
  Francisco escribe rioplatense; contestale igual.
- **Sin router y sin librería de UI.** La navegación es estado en `App.jsx` y
  los estilos son CSS escrito a mano. Es deliberado.
- **Tres dependencias de producción**: `react`, `react-dom` y
  `@supabase/supabase-js`. Antes de agregar una cuarta, decilo y justificala:
  ese número es una decisión del proyecto, no una casualidad.
- Los comentarios explican POR QUÉ, no qué.

## Cómo trabajar acá sin quemar tokens

Francisco paga el consumo y las sesiones son largas.

- **No releas archivos enteros.** `grep -n` acotado y `sed -n` del rango que
  vas a tocar.
- **Editá con reemplazo puntual**, no reescribiendo el archivo completo.
- **Un solo build o test al final**, no uno por cada micro-edición.
- **Capturá pantalla sólo si cambiaste algo visual**, y recortado.
- Agrupá comandos independientes en una sola llamada.
- Leé los archivos que necesites sin pedir permiso: cada ida y vuelta
  reenvía toda la conversación y sale más caro que abrir el archivo.

## Datos

Los gastos y el plan son de Francisco y del resto del grupo. **No pegar datos
reales en commits, issues ni capturas** — tampoco mails de invitación: para
mostrar algo, usar montos y nombres inventados.
