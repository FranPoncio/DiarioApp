# Day by Day — notas para Claude

App de gastos compartidos y checklist de mudanza a Nueva Zelanda, para un
grupo chico de personas. En producción en https://daybyday.franponcioo.workers.dev y se
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
npm run build           # a dist/
npm run deploy          # build + wrangler deploy a Cloudflare, a mano
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
- **El reparto es parejo entre los miembros que ya estaban.** `gastos.deuda` es
  lo que le debe CADA uno de los otros al que pagó, y lo calcula un trigger, no
  el cliente (migración 0010). La app lo recalcula igual para pintar la
  fila sin esperar a la red, pero el que vale es el del servidor.
- **`miembros.desde` decide entre cuántos se divide cada gasto.** El trigger
  cuenta los miembros con `desde <= gastos.fecha`, y la vista `movimientos`
  reparte sólo entre ellos. Sin eso, sumar una persona le atribuía gastos
  anteriores a su llegada y le daba al pagador más de lo que gastó. Si tocás
  esas vistas, no saques la condición de fecha. (Hubo una 0012 por un rato; se
  plegó dentro de la 0010. No la busques.)
- El login es por magic link. No hay contraseñas.
- **Tener cuenta y estar en el grupo son cosas distintas.** El magic link crea
  el usuario solo, pero la RLS filtra por `miembros`. Se entra al grupo por una
  invitación: `traerContexto` llama a `aceptar_invitacion()` cuando el usuario
  no tiene grupo, y esa función (security definer, migración 0011) le crea la
  fila en `miembros` si hay una invitación pendiente para su mail. La app no
  manda mails: la invitación es el permiso esperando.
- **No podés sumar a alguien que nunca entró.** `miembros.user_id` apunta a
  `auth.users`, y esa fila aparece sólo cuando la persona abre su magic link por
  primera vez. Antes de eso no hay id al que apuntar: no es un permiso que
  falte, es un dato que no existe. Cualquier plan que empiece con "cargale el
  mail y listo" se choca con esto.

## El SQL de esta base te va a hacer tropezar

Escrito después de hacer fallar la misma migración cinco veces seguidas. Nada
de esto es teoría.

- **Mirá el esquema real antes de escribir SQL.** `gastos`, `miembros` y `pagos`
  se crearon a mano al principio del proyecto y estuvieron sin versionar mucho
  tiempo. La 0001 las reconstruye, pero está escrita *desde un dump de
  `information_schema`*, no deducida del código. Deducirla del código es
  exactamente el error que costó esas cinco corridas: los nombres de columna
  salen bien y el mecanismo sale mal. Si no tenés acceso a la base, pedí el
  dump antes de escribir una línea.
- **El SQL Editor de Supabase no muestra los `RAISE NOTICE`.** Sólo te pinta el
  resultado de la última consulta. Una migración puede dejar todo mal y salir
  sin decir una palabra. Por eso la 0010 **termina con un `select`** que se
  controla sola, con el valor esperado anotado al lado de cada columna. Si
  escribís una migración que pueda salir mal en silencio, terminala igual.
- **Tampoco muestra el `INSERT 0 1`.** A un insert le dice "Success. No rows
  returned" y nada más, así que no hay forma de saber si escribió una fila o
  ninguna. Ponele `returning` a cualquier insert que le vayas a pasar a alguien
  para que corra.
- **`monto_base` es una columna generada**, en `gastos` y en `pagos`. No se le
  puede asignar nada desde un trigger, y se evalúa *después* del BEFORE trigger:
  por eso `calcular_montos_gasto()` repite la conversión a base inline en vez de
  leerla.
- **`deuda` dejó de ser generada a propósito.** Depende de cuántos miembros hay,
  que sale de contar otra tabla, y una generada sólo puede mirar su propia fila.
- **Cambiarle el tipo a una columna recompila las `CHECK` que la miran.** Si
  alguna tiene el cast al enum escrito adentro (`'propio'::split_tipo`), después
  de convertir queda comparando `text` contra el enum y corta con un 42883,
  "operator does not exist". La 0010 las busca todas, las guarda, las borra,
  convierte y las vuelve a crear sin el cast.
- **`gastos.rubro` sigue siendo un enum**, y la tabla `rubros` (0007) deja crear
  categorías con la `clave` que se quiera. Crear un rubro desde la app y después
  usarlo en un gasto va a fallar con el mismo 42883. **Es una bomba sin
  desactivar**, anterior a todo esto. La receta es la misma que se usó con
  `split`: enum → text con check.

## Sumar a alguien a mano

Cuando la persona ya tiene cuenta pero quedó afuera del grupo, esto la mete sin
pasar por el flujo de invitación:

```sql
insert into miembros (grupo_id, user_id, alias, desde)
select g.grupo_id, u.id, 'Nombre', current_date
  from auth.users u
  cross join (select grupo_id from miembros limit 1) g
 where lower(u.email) = lower('elmail@ejemplo.com')
   and not exists (
     select 1 from miembros x
      where x.grupo_id = g.grupo_id and x.user_id = u.id
   )
returning alias, desde;
```

`desde = current_date` es lo que hace que no herede los gastos anteriores a su
llegada. Si devuelve la tabla vacía, ese mail no coincide con ninguna cuenta.

## Convenciones

- **Todo en castellano**: variables, componentes, comentarios, commits.
  Francisco escribe rioplatense; contestale igual.
- **El deploy es a mano.** Hostea Cloudflare Workers y no hay deploy
  automático: mergear no publica nada, hay que correr `npm run deploy`. Las
  claves de Supabase se inlinean en tiempo de build, así que el `.env` local
  tiene que tener las reales en ese momento.
- **El sitio viejo de Netlify sigue publicado.** Se sacó la config del repo,
  pero la integración vive del lado de Netlify: `daybyday-nz.netlify.app` sigue
  sirviendo una versión vieja y sigue construyendo previews de cada PR. Si
  alguien reporta que la app "no tiene" algo que sí existe, preguntá qué URL
  abrió antes de debuggear cualquier otra cosa.
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

## Cómo escribirle a Francisco

Francisco no programa. Sabe perfectamente qué tiene que hacer la app y decide
bien, pero la terminal, git y el dashboard de Supabase son territorio ajeno.
Eso cambia cómo se dan las instrucciones, y hacerlo mal cuesta horas:

- **Instrucciones completas, no fragmentos.** Bloques enteros para copiar y
  pegar, con la carpeta desde dónde correrlos. Trabaja en **Windows con
  PowerShell**: `ls` y `cp` funcionan, pero el output no se parece al de bash.
- **Decile qué tiene que ver cuando sale bien**, no sólo qué escribir. "Tiene
  que decir 454 kB" o "tienen que salir tres filas" convierte cada paso en algo
  que él puede verificar sin vos. Sin eso, un paso que falló en silencio se
  descubre tres pasos después.
- **No des por sentado que un error salta a la vista.** Una banda roja en una
  pantalla, un "0 rows" donde esperabas uno: si no le dijiste que mire eso, no
  lo va a mirar, y con razón.
- **Explicá la jerga la primera vez.** En esta sesión preguntó qué era un PR
  después de que se lo mencioné veinte veces. Preguntó bien; el problema era
  mío.
- **Nunca le mandes un parche adivinando.** Cada ida y vuelta con una hipótesis
  equivocada le quema tiempo y confianza. Antes: una consulta que distinga las
  causas posibles, con una tabla de "si ves esto, es aquello". Eso resolvió en
  una vuelta lo que cinco parches a ciegas no habían resuelto.
- **Escribí las consultas de diagnóstico para que no muestren datos reales.**
  Contadores y booleanos en vez de mails y montos: así puede pegar el resultado
  sin pensarlo.

## Problemas abiertos

- **El flujo de invitación no funcionó en producción.** Se cargaron dos
  invitaciones desde la app, la UI las mostró en "Esperando que entren", y
  `invitaciones` quedó vacía en la base. Sin resolver. El insert de
  `crearInvitacion` usa `.select().single()`, así que un rechazo de la base
  tendría que haber tirado error visible — hay algo más. Los miembros se
  terminaron sumando a mano (ver arriba).
- **`traerContexto` se come el error de `aceptar_invitacion`.** Hace
  `const { data } = await supabase.rpc(...)` y descarta el `error`, así que un
  fallo de esa función se ve igual que "no te invitaron": el cartel genérico de
  que no perteneces a ningún grupo. Eso es lo que volvió el problema de arriba
  imposible de diagnosticar desde la app. Separar los tres casos —no hay
  invitación / hay pero con otro mail / explotó— es la primera cosa a arreglar
  si se vuelve a tocar esto.
- **`gastos.rubro` es un enum** y choca con la tabla `rubros`. Ver arriba.

## Datos

Los gastos y el plan son de Francisco y del resto del grupo. **No pegar datos
reales en commits, issues ni capturas** — tampoco mails de invitación: para
mostrar algo, usar montos y nombres inventados.
