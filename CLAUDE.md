# Day by Day — notas para Claude

App de gastos compartidos y checklist de mudanza a Nueva Zelanda, para dos
personas. En producción en https://daybyday-nz.netlify.app y se instala en el
celular como PWA.

**Este archivo existe para no redescubrir el repo en cada sesión.** Si algo
acá quedó viejo, corregilo en el momento: cuesta menos que volver a explorar.

## Dónde está cada cosa

```
src/App.jsx              el estado global y el ruteo, que es un useState
src/components/tabs/     las cuatro pantallas: Hoy, Planning, Gastos, Resumen
src/components/          el resto de la UI
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

## Lo que hay que saber antes de tocar

- **Las migraciones no se aplican solas.** Viven en `supabase/migrations/` y
  hay que pegarlas a mano en el SQL Editor de Supabase, en orden. Si agregás
  una columna, el código nuevo no anda hasta que alguien corra el SQL.
- **Todas las tablas tienen Row Level Security**: sólo ves las filas de tu
  grupo. Una consulta que "no devuelve nada" suele ser RLS, no un bug.
- **Los gastos funcionan sin señal**: se guardan local y se sincronizan al
  volver la conexión. Cualquier cambio en el alta de gastos tiene que
  sostener ese camino.
- **Los dos teléfonos se sincronizan en vivo** por Supabase Realtime. Un
  cambio de esquema afecta a las dos puntas a la vez.
- El login es por magic link. No hay contraseñas.

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

Los gastos y el plan son de Francisco y de la otra persona del grupo. **No
pegar datos reales en commits, issues ni capturas**: para mostrar algo, usar
montos y nombres inventados.
