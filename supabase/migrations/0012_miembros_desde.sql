-- Desde cuándo cada miembro participa de los gastos.
--
-- Arregla un error de la 0010. La vista `movimientos` repartía cada gasto
-- entre TODOS los miembros de hoy, sin mirar si esa persona ya estaba en el
-- grupo cuando se cargó el gasto:
--
--   join miembros m on m.grupo_id = g.grupo_id and m.user_id <> g.pagador_id
--
-- Con dos personas nunca se notó. Al entrar la tercera sí: un gasto viejo de
-- $100 pagado por Francisco tenía `deuda` = 50 (la mitad, que era lo correcto
-- cuando eran dos). La vista pasaba a emitir DOS filas de 50 — una por cada
-- no-pagador — así que Francisco quedaba con $100 a favor sobre un gasto de
-- $100, y la persona nueva debiendo por compras anteriores a su llegada.
--
-- Y no alcanzaba con no correr el recálculo retroactivo del final de la 0010:
-- el problema estaba en la vista, no en la columna. Se repartía mal igual.
--
-- La solución es que cada miembro sepa desde cuándo cuenta. El trigger divide
-- entre los que ya estaban a la fecha del gasto, y la vista reparte sólo entre
-- ellos. El historial queda congelado y lo nuevo se divide entre todos.

-- ------------------------------------------------------------------ columna

alter table miembros add column if not exists desde date;

-- Los que ya estaban cubren todo el historial: sin fecha de alta guardada, la
-- única lectura correcta es que estuvieron desde siempre.
update miembros set desde = '2000-01-01' where desde is null;

alter table miembros alter column desde set not null;
alter table miembros alter column desde set default current_date;

-- ------------------------------------------------------------------ trigger

-- Igual que en 0010 pero contando sólo a los que ya estaban a la fecha del
-- gasto. Con esto el recálculo de abajo pasa a ser idempotente: cada gasto se
-- recalcula con la gente que había ese día, no con la de hoy.
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

  select count(*) into n
    from miembros
   where grupo_id = new.grupo_id
     and desde <= new.fecha;

  -- Un gasto anterior a la primera alta no debería existir, pero dividir por
  -- cero rompe la carga y perder el gasto es peor que guardar una deuda de más.
  if n is null or n < 1 then
    n := 1;
  end if;

  new.deuda := case new.split
    when 'propio' then 0
    when 'exacto' then round(coalesce(new.monto_exacto, 0), 2)
    else round(new.monto_base / n, 2)
  end;

  return new;
end $$;

-- ------------------------------------------------------------------- vistas

drop view if exists saldos;
drop view if exists saldos_por_par;
drop view if exists movimientos;

-- El `m.desde <= g.fecha` es el arreglo: un gasto sólo se reparte entre los
-- que ya estaban cuando se cargó.
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

-- --------------------------------------------------------------- invitación

-- El que entra por invitación cuenta desde el día que entra, no desde antes.
create or replace function aceptar_invitacion()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invitaciones;
begin
  if auth.uid() is null or mi_email() = '' then
    return null;
  end if;

  select * into inv
    from invitaciones
   where lower(email) = mi_email()
     and aceptada_en is null
   order by creada
   limit 1;

  if not found then
    return null;
  end if;

  insert into miembros (grupo_id, user_id, alias, desde)
  select inv.grupo_id, auth.uid(), inv.alias, current_date
   where not exists (
     select 1 from miembros
      where grupo_id = inv.grupo_id
        and user_id = auth.uid()
   );

  update invitaciones
     set aceptada_en = now(),
         aceptada_por = auth.uid()
   where id = inv.id;

  return inv.grupo_id;
end $$;

-- Recalcular con el criterio nuevo. A diferencia de la 0010, esto ya se puede
-- correr las veces que haga falta: cada gasto se reparte entre los que estaban
-- a SU fecha, así que sumar gente después no lo cambia.
update gastos set monto = monto;

notify pgrst, 'reload schema';
