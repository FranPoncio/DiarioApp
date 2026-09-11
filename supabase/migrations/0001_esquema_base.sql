-- Esquema base: miembros, gastos, pagos y las vistas de saldos.
--
-- Estas tablas se crearon a mano en el SQL Editor cuando arrancó el proyecto
-- y nunca quedaron versionadas — por eso las migraciones empezaban en 0002.
-- Esto las reconstruye desde cero para que una base nueva quede igual a la
-- de producción, y para que el modelo de deuda esté escrito en algún lado.
--
-- CUÁNDO CORRERLO
--   · Base nueva  → corré este archivo primero y después 0002…0010 en orden.
--   · Base actual → NO hace falta: todo es `if not exists` y no pisa datos,
--     pero lo que te interesa ya está en 0010. Saltá directo ahí.
--
-- Cómo se reparte un gasto, que es lo único que no es obvio de las tablas:
-- `deuda` es lo que le debe CADA uno de los otros miembros al que pagó. Con
-- N personas y reparto parejo eso es monto_base / N, y al pagador le quedan
-- a favor deuda × (N-1). Con N=2 da monto_base / 2, que es lo que la app
-- venía calculando cuando el grupo era siempre de dos.

-- ------------------------------------------------------------------ grupos

-- `grupos` la crea 0002. Se repite acá para que este archivo se pueda correr
-- solo en una base vacía: gastos y pagos referencian grupo_id.
create table if not exists grupos (
  id            uuid primary key default gen_random_uuid(),
  fecha_llegada date,
  creado        timestamptz not null default now()
);

-- ---------------------------------------------------------------- miembros

-- Quién pertenece a qué grupo. No hay alta desde la app: los miembros se
-- agregan a mano desde Supabase (ver el cartel en App.jsx).
create table if not exists miembros (
  grupo_id uuid not null,
  user_id  uuid not null references auth.users(id) on delete cascade,
  alias    text not null,
  color    text,
  creado   timestamptz not null default now(),
  primary key (grupo_id, user_id)
);

create index if not exists miembros_user_id_idx on miembros (user_id);

alter table miembros enable row level security;

-- Ojo con la recursión: la policy de `miembros` no puede consultar `miembros`
-- con un subselect como el resto de las tablas, porque se llama a sí misma.
-- Por eso acá el criterio es directo (tu propia fila) más los grupos que ya
-- resolvió `mis_grupos()`, que es security definer y no dispara RLS.
create or replace function mis_grupos()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select grupo_id from miembros where user_id = auth.uid();
$$;

drop policy if exists "miembros: ver los del propio grupo" on miembros;
create policy "miembros: ver los del propio grupo"
  on miembros for select
  using (grupo_id in (select mis_grupos()));

-- ------------------------------------------------------------------ gastos

create table if not exists gastos (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null,
  fecha        date not null default current_date,
  descripcion  text,
  rubro        text not null default 'otros',
  monto        numeric(12,2) not null check (monto > 0),
  moneda       text not null default 'NZD' check (moneda in ('NZD','USD','AUD','ARS')),
  tc_a_base    numeric(14,7) not null default 1,
  -- monto_base y deuda los calcula el trigger, nunca el cliente: la app manda
  -- un valor optimista para pintar la fila antes de que conteste la red, pero
  -- el que vale es el del servidor (ver calcularMontos en src/lib/gastos).
  monto_base   numeric(12,2) not null default 0,
  pagador_id   uuid not null references auth.users(id),
  -- En la base original esto era un enum (`split_tipo`). Se pasó a text con un
  -- check en la 0010: agregarle un valor a un enum no se puede usar en la misma
  -- transacción, y eso hacía imposible renombrar 'mitad' a 'parejo' de una.
  split        text not null default 'parejo'
               check (split in ('parejo','mitad','propio','exacto')),
  monto_exacto numeric(12,2),
  deuda        numeric(12,2) not null default 0,
  recurrente   boolean not null default false,
  recibo_path  text,
  creado       timestamptz not null default now()
);

create index if not exists gastos_grupo_fecha_idx on gastos (grupo_id, fecha desc);

alter table gastos enable row level security;

drop policy if exists "gastos: ver del propio grupo" on gastos;
create policy "gastos: ver del propio grupo"
  on gastos for select
  using (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

drop policy if exists "gastos: crear en el propio grupo" on gastos;
create policy "gastos: crear en el propio grupo"
  on gastos for insert
  with check (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

drop policy if exists "gastos: editar del propio grupo" on gastos;
create policy "gastos: editar del propio grupo"
  on gastos for update
  using (grupo_id in (select grupo_id from miembros where user_id = auth.uid()))
  with check (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

drop policy if exists "gastos: borrar del propio grupo" on gastos;
create policy "gastos: borrar del propio grupo"
  on gastos for delete
  using (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

-- ------------------------------------------------------------------- pagos

-- Un saldado entre dos personas: `de_id` le pagó a `a_id`. Cancela deuda en
-- esa dirección, así que nunca se reparte entre todos.
create table if not exists pagos (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null,
  de_id      uuid not null references auth.users(id),
  a_id       uuid not null references auth.users(id),
  monto      numeric(12,2) not null check (monto > 0),
  moneda     text not null default 'NZD',
  tc_a_base  numeric(14,7) not null default 1,
  monto_base numeric(12,2) not null default 0,
  fecha      date not null default current_date,
  creado     timestamptz not null default now(),
  constraint pagos_partes_distintas check (de_id <> a_id)
);

create index if not exists pagos_grupo_idx on pagos (grupo_id);

alter table pagos enable row level security;

drop policy if exists "pagos: ver del propio grupo" on pagos;
create policy "pagos: ver del propio grupo"
  on pagos for select
  using (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

drop policy if exists "pagos: crear en el propio grupo" on pagos;
create policy "pagos: crear en el propio grupo"
  on pagos for insert
  with check (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

drop policy if exists "pagos: borrar del propio grupo" on pagos;
create policy "pagos: borrar del propio grupo"
  on pagos for delete
  using (grupo_id in (select grupo_id from miembros where user_id = auth.uid()));

-- El detalle del reparto parejo (triggers y vistas) vive en 0010, para no
-- duplicar la definición en dos archivos que después se desincronizan.

-- Realtime: `add table` no tiene `if not exists`, y repetirlo aborta la
-- transacción entera. Se traga el duplicado para que el archivo se pueda
-- correr dos veces sin romper nada.
do $$
begin
  alter publication supabase_realtime add table gastos;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table pagos;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
