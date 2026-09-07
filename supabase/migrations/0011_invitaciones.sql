-- Invitaciones: sumar a alguien al grupo sin entrar a Supabase.
--
-- Hasta acá había que hacerlo a mano con un insert en `miembros`, porque
-- tener cuenta y pertenecer a un grupo son cosas distintas: el magic link
-- crea el usuario solo (signInWithOtp con shouldCreateUser en true, que es
-- el default), pero toda la RLS filtra por `miembros`, así que el que entra
-- sin fila ve "tu usuario todavía no está en ningún grupo" y no puede hacer
-- nada.
--
-- Cómo funciona: dejás una invitación con el mail y el alias. Cuando esa
-- persona entra por primera vez, la app llama a `aceptar_invitacion()`, que
-- busca una invitación pendiente para el mail del que está logueado y le
-- crea la fila en `miembros`. Nadie manda un mail desde acá — el aviso se lo
-- pasás vos por donde quieras, la invitación es sólo el permiso esperando.

create table if not exists invitaciones (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null references grupos(id) on delete cascade,
  email        text not null,
  alias        text not null,
  invitado_por uuid references auth.users(id),
  creada       timestamptz not null default now(),
  aceptada_en  timestamptz,
  aceptada_por uuid references auth.users(id),
  -- Validación mínima, sólo para que no entre texto suelto. La de verdad la
  -- hace el magic link: si el mail no existe, la invitación nunca se acepta.
  constraint invitaciones_email_check check (position('@' in email) > 1)
);

-- Una sola invitación pendiente por mail y grupo. Las ya aceptadas quedan
-- fuera del índice, así que se puede volver a invitar a alguien que se fue.
create unique index if not exists invitaciones_pendiente_idx
  on invitaciones (grupo_id, lower(email))
  where aceptada_en is null;

alter table invitaciones enable row level security;

-- El mail del que está logueado, normalizado. Los mails no distinguen
-- mayúsculas en la práctica y el que invita los escribe a mano, así que todas
-- las comparaciones van en minúscula.
--
-- Ojo: esto confía en el claim `email` del JWT. Con magic link está bien,
-- porque para tener ese token hay que haber abierto el link en esa casilla.
-- Si algún día se agrega un proveedor OAuth que devuelva mails sin verificar,
-- hay que chequear también `email_verified` acá.
create or replace function mi_email()
returns text
language sql
stable
as $$
  select lower(coalesce(nullif(auth.jwt() ->> 'email', ''), ''));
$$;

-- Los del grupo ven y manejan sus invitaciones.
drop policy if exists "invitaciones: ver las del propio grupo" on invitaciones;
create policy "invitaciones: ver las del propio grupo"
  on invitaciones for select
  using (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

drop policy if exists "invitaciones: crear en el propio grupo" on invitaciones;
create policy "invitaciones: crear en el propio grupo"
  on invitaciones for insert
  with check (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

drop policy if exists "invitaciones: borrar las del propio grupo" on invitaciones;
create policy "invitaciones: borrar las del propio grupo"
  on invitaciones for delete
  using (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

-- El invitado todavía no está en ningún grupo, así que ninguna policy de
-- arriba lo alcanza: puede ver la invitación dirigida a su mail y nada más.
-- Le sirve a la app para saber a qué grupo lo están invitando antes de
-- aceptar.
drop policy if exists "invitaciones: ver la propia" on invitaciones;
create policy "invitaciones: ver la propia"
  on invitaciones for select
  using (lower(email) = mi_email());

-- ------------------------------------------------------------- aceptar

-- Es `security definer` a propósito: el invitado no está en `miembros`
-- todavía, así que no hay forma de darle un insert por RLS sin abrir la
-- tabla a cualquiera. Acá el user_id que se inserta es siempre `auth.uid()`
-- y el grupo sale de una invitación que coincide con su mail: no hay ningún
-- parámetro del cliente del que fiarse.
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

  -- `where not exists` en vez de `on conflict`: la tabla `miembros` se creó a
  -- mano al principio del proyecto y no hay garantía de que tenga la unique
  -- sobre (grupo_id, user_id) que pide el on conflict. Esto anda igual con o
  -- sin ella.
  insert into miembros (grupo_id, user_id, alias)
  select inv.grupo_id, auth.uid(), inv.alias
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

revoke all on function aceptar_invitacion() from public;
grant execute on function aceptar_invitacion() to authenticated;

-- Sumar un miembro cambia entre cuántos se reparte, pero sólo para los gastos
-- que se carguen a partir de ahora: los viejos guardan la deuda con la que se
-- cargaron. Si querés repartir todo el historial entre los que están hoy,
-- corré a mano el update del final de la migración 0010.

notify pgrst, 'reload schema';
