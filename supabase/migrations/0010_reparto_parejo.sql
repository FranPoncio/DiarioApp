-- Reparto parejo entre N personas.
--
-- Hasta acá el reparto asumía dos. La app resolvía la contraparte con "el
-- primero que no sea yo", y saldar cuentas liquidaba el neto entero contra esa
-- persona: con tres, le paga de más a una y deja a la otra sin cobrar.
--
-- Escrito contra el esquema REAL de la base, no contra el que se deducía
-- leyendo la app — que es lo que venía haciendo fallar esta migración. Lo que
-- hay que saber:
--
--   · `gastos.monto_base` y `pagos.monto_base` son columnas GENERADAS
--     (`round(monto * tc_a_base, 2)`). Están bien: no se tocan.
--   · `gastos.deuda` también era generada, y valía
--     `monto_base * (partes-1) / partes` — el TOTAL que le deben al pagador.
--     Acá pasa a ser lo que le debe CADA uno de los otros. Con dos personas
--     las dos fórmulas dan lo mismo; con tres no, y por eso hay que cambiarla.
--   · `gastos.partes` ya existía (int, default 2) y la app nunca la mandaba.
--     Ahora la llena el trigger con la cantidad real de participantes, así
--     cada fila queda diciendo entre cuántos se dividió.
--   · `gastos.tipo` distingue 'gasto' de 'ingreso'. Un ingreso no genera
--     deuda, y eso se respeta.
--   · `miembros.desde` ya existía. Un gasto se reparte sólo entre los que ya
--     estaban a su fecha, así que sumar gente no toca el historial.
--
-- Por qué `deuda` deja de ser generada: una generada sólo puede mirar su
-- propia fila, y para saber entre cuántos se divide hay que contar `miembros`,
-- que está en otra tabla. No hay expresión que lo resuelva.

-- ------------------------------------------------------------------ vistas

-- Se borran primero: Postgres no deja cambiarle el tipo a una columna de la
-- que depende una vista. Se recrean al final.
drop view if exists saldos;
drop view if exists saldos_por_par;
drop view if exists movimientos;

-- ---------------------------------------------------------- miembros.desde

-- `desde` tiene default CURRENT_DATE, así que los miembros que ya estaban
-- pueden haber quedado con una fecha reciente. Si pasa eso, sus gastos viejos
-- no tendrían participantes y la cuenta saldría cualquier cosa. Se los corre
-- hacia atrás hasta cubrir el primer gasto del grupo.
--
-- OJO: esto corre una sola vez y va ANTES de sumar gente nueva. Si lo corrés
-- después, al que recién entró le vas a correr la fecha para atrás y le vas a
-- atribuir gastos anteriores a su llegada.
update miembros m
   set desde = least(
     m.desde,
     coalesce((select min(g.fecha) from gastos g where g.grupo_id = m.grupo_id), m.desde)
   );

update miembros set desde = current_date where desde is null;

alter table miembros alter column desde set default current_date;
alter table miembros alter column desde set not null;

-- ------------------------------------------------------------------ deuda

-- De columna generada a columna común, conservando los valores que ya tiene.
-- A partir de acá la llena el trigger de más abajo.
alter table gastos alter column deuda drop expression if exists;
alter table gastos alter column deuda set default 0;

-- `monto_base` NO se toca, ni acá ni en `pagos`: su expresión es correcta y se
-- mantiene sola. El trigger tampoco le asigna nada — a una columna generada no
-- se le puede asignar.

-- ------------------------------------------------ split: 'mitad' → 'parejo'

-- `split` es un enum (`split_tipo`). Agregarle un valor no permite usarlo en
-- la misma transacción, así que renombrar 'mitad' a 'parejo' no entraría en
-- una sola corrida. Se pasa a text con un check: queda igual de validada y
-- sumar un valor mañana es una línea.
--
-- El default se suelta antes de convertir: es un valor del tipo viejo.
--
-- Y el lío que costó un intento: al cambiarle el tipo a la columna, Postgres
-- vuelve a compilar las CHECK que la miran. Las que tengan el cast al enum
-- escrito adentro ('propio'::split_tipo) quedan comparando text contra
-- split_tipo y cortan con un 42883 — "operator does not exist". No alcanza con
-- borrar la que sé cómo se llama: hay que buscarlas todas.
--
-- Así que se guardan, se borran, se convierte la columna y se vuelven a crear
-- con el cast sacado. Las que sólo enumeran los valores válidos no se recrean:
-- las reemplaza el check de abajo, que es el mismo pero acepta 'parejo'.
do $$
declare
  c       record;
  nombres text[] := '{}';
  defs    text[] := '{}';
  i       int;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'gastos'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~ '\msplit\M'
  loop
    raise notice 'split: borro la check % (%)', c.conname, c.def;
    if c.def !~* 'split\s*=\s*any' and c.def !~* 'split\s+in\s*\(' then
      nombres := nombres || c.conname;
      defs    := defs || c.def;
    end if;
    execute format('alter table gastos drop constraint %I', c.conname);
  end loop;

  execute 'alter table gastos alter column split drop default';
  execute 'alter table gastos alter column split type text using split::text';

  for i in 1 .. coalesce(array_length(nombres, 1), 0) loop
    raise notice 'split: recreo la check %', nombres[i];
    execute format(
      'alter table gastos add constraint %I %s',
      nombres[i],
      regexp_replace(defs[i], '::(public\.)?split_tipo', '', 'g')
    );
  end loop;
end $$;

-- Se deja 'mitad' aceptado en el check: puede haber gastos esperando en la
-- cola offline de un celular que todavía no abrió la versión nueva, y si el
-- check los rechaza el gasto se pierde. El trigger los normaliza al insertar.
alter table gastos drop constraint if exists gastos_split_check;
alter table gastos add constraint gastos_split_check
  check (split in ('parejo','mitad','propio','exacto'));

update gastos set split = 'parejo' where split = 'mitad';

alter table gastos alter column split set default 'parejo';

-- El enum queda sin uso. Se borra sólo si nada más lo referencia.
do $$
begin
  drop type if exists split_tipo;
exception when dependent_objects_still_exist then null;
end $$;

-- ---------------------------------------------------------------- trigger

-- El servidor es el que manda con la plata. El cliente calcula lo mismo para
-- pintar la fila sin esperar a la red, pero el valor que queda guardado es
-- este: si no, dos celulares con distinta cantidad de miembros cacheada
-- escribirían deudas distintas para el mismo gasto.
--
-- `monto_base` no se asigna acá: es generada y Postgres la calcula sola
-- después de este trigger. Por eso la conversión a NZD se repite inline.
create or replace function calcular_montos_gasto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n    int;
  base numeric;
begin
  if new.split = 'mitad' then
    new.split := 'parejo';
  end if;

  base := round(new.monto * coalesce(nullif(new.tc_a_base, 0), 1), 2);

  -- Participantes: los que ya estaban a la fecha del gasto. Así el historial
  -- queda congelado y sumar gente sólo afecta lo que se carga de ahí en más.
  select count(*) into n
    from miembros
   where grupo_id = new.grupo_id
     and desde <= new.fecha;

  -- Un gasto anterior a la primera alta no debería existir, pero dividir por
  -- cero rompe la carga, y perder el gasto es peor que guardar una deuda de más.
  if n is null or n < 1 then
    n := 1;
  end if;

  new.partes := n;

  new.deuda := case
    -- Un ingreso no reparte nada. Estaba en la expresión original y se respeta.
    when coalesce(new.tipo, 'gasto') = 'ingreso' then 0
    when new.split = 'propio' then 0
    -- 'exacto' es por persona: lo que le toca a cada uno de los otros, no el
    -- total a repartir. Con N=2 es idéntico a lo que significaba antes.
    when new.split = 'exacto' then round(coalesce(new.monto_exacto, 0), 2)
    else round(base / n, 2)
  end;

  return new;
end $$;

drop trigger if exists gastos_calcular_montos on gastos;
create trigger gastos_calcular_montos
  before insert or update on gastos
  for each row execute function calcular_montos_gasto();

-- `pagos` no necesita trigger: su `monto_base` ya es generada y correcta.
drop trigger if exists pagos_calcular_monto on pagos;
drop function if exists calcular_monto_pago();

-- Recalcular lo ya cargado con el criterio nuevo. Es idempotente: cada gasto
-- se reparte entre los que estaban a SU fecha, así que se puede correr las
-- veces que haga falta y sumar gente después no lo cambia.
update gastos set monto = monto;

-- ----------------------------------------------------------------- vistas
--
-- Las tres usan `security_invoker`, que necesita Postgres 15 o mayor. Si el
-- proyecto fuera más viejo, el `alter view` corta acá con un error y no se
-- crea nada: es a propósito. Sin esa opción la vista correría con permisos de
-- su dueño y saltearía la RLS — cualquiera vería los saldos de todos los
-- grupos. Antes que eso, que no ande.

-- Un movimiento es siempre "el deudor le debe `monto` al acreedor". Los gastos
-- generan uno por cada participante que no pagó; los pagos generan uno en
-- sentido inverso, que es lo que cancela la deuda.
--
-- El `m.desde <= g.fecha` es lo que congela el historial: un gasto sólo se
-- reparte entre los que ya estaban cuando se cargó.
create view movimientos as
  select g.grupo_id, g.pagador_id as acreedor_id, m.user_id as deudor_id, g.deuda as monto
  from gastos g
  join miembros m
    on m.grupo_id = g.grupo_id
   and m.user_id <> g.pagador_id
   and m.desde <= g.fecha
  where g.deuda <> 0
  union all
  select p.grupo_id, p.de_id as acreedor_id, p.a_id as deudor_id, p.monto_base as monto
  from pagos p;

alter view movimientos set (security_invoker = on);

-- Cuánto le debe `deudor_id` a `acreedor_id`, neteado en las dos direcciones.
-- Sale una fila por cada par ordenado, así que el cliente filtra por
-- acreedor_id = su propio id y ya tiene la lista completa: positivo es que le
-- deben, negativo es que debe.
create view saldos_por_par as
  select
    a.grupo_id,
    a.user_id as acreedor_id,
    b.user_id as deudor_id,
    coalesce((
      select sum(m.monto) from movimientos m
      where m.grupo_id = a.grupo_id
        and m.acreedor_id = a.user_id and m.deudor_id = b.user_id
    ), 0)
    - coalesce((
      select sum(m.monto) from movimientos m
      where m.grupo_id = a.grupo_id
        and m.acreedor_id = b.user_id and m.deudor_id = a.user_id
    ), 0) as saldo
  from miembros a
  join miembros b on b.grupo_id = a.grupo_id and b.user_id <> a.user_id;

alter view saldos_por_par set (security_invoker = on);

-- El neto por persona. La app ya no la consulta (el header arma el neto desde
-- saldos_por_par, que además le dice a quién cobrarle), pero se mantiene para
-- mirar el estado de un grupo de una desde el SQL Editor.
create view saldos as
  select
    m.grupo_id,
    m.user_id,
    coalesce((
      select sum(s.saldo) from saldos_por_par s
      where s.grupo_id = m.grupo_id and s.acreedor_id = m.user_id
    ), 0) as saldo
  from miembros m;

alter view saldos set (security_invoker = on);

grant select on movimientos, saldos_por_par, saldos to authenticated;

-- Entrar o salir del grupo cambia el reparto de lo que se cargue después, así
-- que la app se suscribe a `miembros` para refrescar (ver escucharCambios).
-- Sin la tabla en la publicación esa suscripción no falla: simplemente no
-- llega nada nunca, que es peor.
do $$
begin
  alter publication supabase_realtime add table miembros;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------ control final

-- El SQL Editor de Supabase no muestra los RAISE NOTICE: sólo te pinta el
-- resultado de la última consulta. Así que la migración termina con un select,
-- que es lo único que se ve, y se controla sola.
--
-- Todo tiene que dar lo que dice el comentario. Si algo no da, el reparto
-- quedó mal y no hay que publicar la app todavía — con `partes` en 1 los
-- saldos salen al doble, que es peor que no haber tocado nada.
select
  -- 'text'
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'gastos'
      and column_name = 'split')                                  as split_es,
  -- 'NEVER' — dejó de ser generada, la llena el trigger
  (select is_generated from information_schema.columns
    where table_schema = 'public' and table_name = 'gastos'
      and column_name = 'deuda')                                  as deuda_generada,
  -- 0
  (select count(*) from gastos where split = 'mitad')             as quedan_en_mitad,
  -- 3
  (select count(*) from pg_views
    where schemaname = 'public'
      and viewname in ('movimientos', 'saldos_por_par', 'saldos')) as vistas,
  -- 0: gastos cuyo grupo no tiene ni un miembro. Si esto no da cero, los
  -- `grupo_id` de las dos tablas no coinciden y nada del reparto funciona.
  (select count(*) from gastos g
    where not exists (select 1 from miembros m
                       where m.grupo_id = g.grupo_id))            as gastos_huerfanos,
  -- 0: gastos cuyo `partes` no coincide con la gente que había a su fecha.
  -- No se compara contra 2: un grupo de uno reparte entre uno y está bien.
  -- Lo que no puede pasar es que el reparto diga menos de los que estaban.
  (select count(*) from gastos g
    where g.partes < (select count(*) from miembros m
                       where m.grupo_id = g.grupo_id
                         and m.desde <= g.fecha))                 as mal_repartidos,
  -- 0.00 exacto: lo que cada uno debe tiene que cancelar con lo que le deben
  (select coalesce(round(sum(saldo), 2), 0) from saldos)          as saldos_suman;
