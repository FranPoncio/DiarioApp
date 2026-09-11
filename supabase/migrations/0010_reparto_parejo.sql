-- Reparto parejo entre N personas.
--
-- Hasta acá el grupo era de dos y el saldo se guardaba como un solo número
-- por persona: alcanzaba, porque tu saldo era exactamente el inverso del
-- saldo del otro. Con tres o más eso deja de servir — el neto te dice cuánto
-- te deben en total, no quién, y "saldar cuentas" terminaba liquidando todo
-- contra una persona elegida al azar.
--
-- El modelo nuevo:
--   · `gastos.deuda` = lo que le debe CADA uno de los otros al que pagó.
--     Con reparto parejo eso es monto_base / N (N = miembros del grupo).
--     Al pagador le quedan a favor deuda × (N-1).
--   · `saldos_por_par` = cuánto le debe cada persona a cada otra.
--   · `saldos` sigue existiendo con la misma forma de antes (el neto por
--     persona), para mirar un grupo de una desde el SQL Editor.
--
-- Con N=2 la cuenta da igual que antes, así que los gastos viejos no cambian
-- de significado y no hay que recalcular nada a mano.

-- ------------------------------------------------ split: 'mitad' → 'parejo'

-- Las vistas se borran acá arriba, antes de tocar la columna: Postgres no deja
-- cambiarle el tipo a una columna de la que depende una vista. Se recrean al
-- final del archivo.
drop view if exists saldos;
drop view if exists saldos_por_par;
drop view if exists movimientos;

-- `gastos.split` es un enum (`split_tipo`), no text. Eso lo vuelve un dolor:
-- `alter type ... add value` no permite usar el valor nuevo en la misma
-- transacción, así que renombrar 'mitad' a 'parejo' no entra en una sola
-- corrida. Se pasa la columna a text con un check, que además es lo que asume
-- el resto de estas migraciones y lo que hace que sumar un valor mañana sea
-- una línea en vez de un baile de dos pasos.
--
-- El default hay que soltarlo antes de convertir: es un valor del tipo viejo.
alter table gastos alter column split drop default;
alter table gastos alter column split type text using split::text;

-- "Mitad" era el nombre correcto cuando eran dos. Se migran las filas y se
-- deja 'mitad' aceptado en el check: puede haber gastos esperando en la cola
-- offline de un celular que todavía no abrió la versión nueva, y si el check
-- los rechaza el gasto se pierde. El trigger los normaliza al insertar.
alter table gastos drop constraint if exists gastos_split_check;
alter table gastos add constraint gastos_split_check
  check (split in ('parejo','mitad','propio','exacto'));

update gastos set split = 'parejo' where split = 'mitad';

alter table gastos alter column split set default 'parejo';

-- El enum queda sin uso. Se borra sólo si nada más lo referencia: si alguna
-- otra columna todavía lo usa, se lo deja donde está y no pasa nada.
do $$
begin
  drop type if exists split_tipo;
exception when dependent_objects_still_exist then null;
end $$;

-- --------------------------------------------------------- pagos.monto_base

-- Los pagos se cargaban siempre en NZD, así que el monto en base nunca hizo
-- falta. Ahora la vista los suma junto con los gastos y necesita la columna.
alter table pagos add column if not exists monto_base numeric(12,2) not null default 0;

update pagos set monto_base = round(monto * coalesce(nullif(tc_a_base, 0), 1), 2)
where monto_base = 0;

-- -------------------------------------------------------------- triggers

-- El servidor es el que manda con la plata: el cliente calcula lo mismo para
-- pintar la fila sin esperar a la red, pero el valor que queda guardado es
-- este. Si no fuera así, dos celulares con distinta cantidad de miembros
-- cacheada escribirían deudas distintas para el mismo gasto.
create or replace function calcular_montos_gasto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if new.split = 'mitad' then
    new.split := 'parejo';
  end if;

  new.monto_base := round(new.monto * coalesce(nullif(new.tc_a_base, 0), 1), 2);

  select count(*) into n from miembros where grupo_id = new.grupo_id;
  -- Un grupo sin miembros no debería existir, pero dividir por cero rompe la
  -- carga del gasto y perder el gasto es peor que guardar una deuda de más.
  if n is null or n < 1 then
    n := 1;
  end if;

  new.deuda := case new.split
    when 'propio' then 0
    -- 'exacto' es por persona: lo que le toca a cada uno de los otros, no el
    -- total a repartir. Con N=2 es idéntico a lo que significaba antes.
    when 'exacto' then round(coalesce(new.monto_exacto, 0), 2)
    else round(new.monto_base / n, 2)
  end;

  return new;
end $$;

drop trigger if exists gastos_calcular_montos on gastos;
create trigger gastos_calcular_montos
  before insert or update on gastos
  for each row execute function calcular_montos_gasto();

create or replace function calcular_monto_pago()
returns trigger
language plpgsql
as $$
begin
  new.monto_base := round(new.monto * coalesce(nullif(new.tc_a_base, 0), 1), 2);
  return new;
end $$;

drop trigger if exists pagos_calcular_monto on pagos;
create trigger pagos_calcular_monto
  before insert or update on pagos
  for each row execute function calcular_monto_pago();

-- Recalcular los gastos ya cargados con la cantidad de miembros de hoy.
--
-- OJO: lo que sigue quedó viejo, lo arregla la migración 0012. Este recálculo
-- usa la cantidad de miembros de HOY para todos los gastos, y la vista de más
-- abajo reparte cada gasto entre todos los miembros actuales — las dos cosas
-- ignoran cuándo entró cada uno, así que sumar una tercera persona rompía el
-- historial. En 0012 los miembros pasan a tener fecha de alta y esto se vuelve
-- correcto e idempotente. Si estás corriendo las migraciones en orden, seguí
-- de largo: 0012 lo deja bien.
update gastos set monto = monto;

-- --------------------------------------------------------------- vistas
--
-- Las tres vistas usan `security_invoker`, que necesita Postgres 15 o mayor.
-- Si el proyecto es más viejo el `alter view` corta acá con un error y no se
-- crea nada: es a propósito. Sin esa opción la vista correría con permisos de
-- su dueño y saltearía la RLS, o sea que cualquiera vería los saldos de todos
-- los grupos. Antes que eso, que no ande.

-- Ya se borraron arriba, antes de tocar `split`. Se repite por si este bloque
-- se corre suelto: son `if exists`, así que no molesta.
drop view if exists saldos;
drop view if exists saldos_por_par;
drop view if exists movimientos;

-- Un movimiento es siempre "el deudor le debe `monto` al acreedor". Los
-- gastos generan uno por cada miembro que no pagó; los pagos generan uno en
-- sentido inverso, que es lo que cancela la deuda.
create view movimientos as
  select g.grupo_id, g.pagador_id as acreedor_id, m.user_id as deudor_id, g.deuda as monto
  from gastos g
  join miembros m on m.grupo_id = g.grupo_id and m.user_id <> g.pagador_id
  where g.deuda <> 0
  union all
  select p.grupo_id, p.de_id as acreedor_id, p.a_id as deudor_id, p.monto_base as monto
  from pagos p;

-- security_invoker: la vista se evalúa con los permisos del que consulta, así
-- que hereda la RLS de gastos/pagos/miembros en vez de saltearla. Sin esto
-- cualquiera vería los saldos de todos los grupos.
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

-- El neto por persona: la suma de lo que le deben menos lo que debe. La app
-- ya no la consulta (el header arma el neto desde saldos_por_par, que además
-- le dice a quién cobrarle), pero se mantiene con la misma forma de siempre
-- para mirar el estado de un grupo de una desde el SQL Editor.
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

-- Entrar o salir del grupo cambia entre cuántos se reparte, así que la app se
-- suscribe a `miembros` para refrescar los saldos (ver escucharCambios). Sin
-- la tabla en la publicación esa suscripción no falla: simplemente no llega
-- nada nunca, que es peor.
do $$
begin
  alter publication supabase_realtime add table miembros;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
