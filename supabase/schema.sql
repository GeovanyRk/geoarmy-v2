-- ============================================================================
-- GEO ARMY — "Mi Geo Army" — Fase 1 (v8: FINAL, LISTO PARA EJECUTAR)
-- v7 quedó aprobada salvo DOS carreras de concurrencia en el manejo de
-- idempotencia. Corrección exclusiva de esos dos puntos, sin tocar nada
-- más de v7:
--   D. `request_redemption()` — recheck de `request_key` DESPUÉS de tomar
--      el `for update` sobre `wallet_balances`. Sin esto, dos llamadas
--      concurrentes con el mismo `request_key` podían pasar juntas el
--      primer chequeo (antes de que ninguna hubiera insertado), y la que
--      esperaba el lock del wallet podía ver el saldo ya reservado por la
--      otra y lanzar "saldo insuficiente" en vez de devolver la solicitud
--      ya creada — rompiendo la idempotencia de un retry idéntico. Ahora,
--      justo después del lock: si el `request_key` ya existe, se revalida
--      (mismos user_id/currency_code/amount/requested_item/
--      account_identifier/user_notes) y se devuelve esa solicitud; si no
--      coincide, `RAISE EXCEPTION`; solo si sigue sin existir, continúa
--      con el chequeo de disponible + reserva + insert. El handler de
--      `unique_violation` en el INSERT se mantiene como última defensa.
--   E. `wallet_apply_transaction()` — mismo patrón: recheck de
--      `idempotency_key` DESPUÉS del `for update` sobre `wallet_balances`
--      y ANTES de calcular/validar `v_new_balance`. Mismo problema (dos
--      llamadas concurrentes, ej. dos `spend` idénticos con la misma key,
--      podían chocar contra "saldo insuficiente" en vez de idempotencia) y
--      misma solución: revalida profile_id/currency_code/type/amount/
--      source/description/metadata/created_by, devuelve la transacción
--      existente si coincide, `RAISE EXCEPTION` si no. El `unique_violation`
--      del INSERT se mantiene como última defensa.
--
-- Todo lo demás de v7 (ver más abajo el detalle histórico de v6/v7) queda
-- exactamente igual: RLS, GRANTs, wallet+ledger, reserved, GCOIN
-- externally_managed/inactivo, request_key obligatorio, metadata
-- administrativa, límites de inputs, twitch_membership, vistas,
-- redemptions, arquitectura futura de Discord/tienda.
--
-- Historial v6 -> v7 (se mantiene, ver detalle abajo). Estos son los
-- últimos 3 ajustes que se hicieron sobre v6 antes de v7:
--   A. `request_redemption()` ya NO recibe `p_metadata` — un usuario
--      authenticated no puede escribir `redemption_requests.metadata`
--      (ese campo queda exclusivamente para el backend/admin, vía
--      `admin_update_redemption_status()` o un futuro ajuste directo).
--      Se quitó también de las comparaciones de idempotencia de esta
--      función.
--   B. Límites de longitud en los inputs de canje: `requested_item` y
--      `account_identifier` hasta 200 caracteres, `user_notes` hasta 1000
--      — como CHECK constraints en la tabla (nunca se puede insertar algo
--      más largo, ni siquiera por otra vía) Y validados explícitamente al
--      inicio de `request_redemption()` (mensaje de error claro antes de
--      tocar balances).
--   C. `wallet_apply_transaction()` sigue siendo solo para `service_role`,
--      pero ahora exige `p_idempotency_key` para cualquier `type` que no
--      sea `adjustment` — earn/spend/refund son, por diseño, los tipos
--      que un evento automático (Streamer.bot, Gacha, un futuro sync de
--      GCOIN) dispara, y siempre deben traer su propia key. `adjustment`
--      quedó como la única excepción, porque es exactamente el tipo
--      reservado para una corrección manual de un admin, que no
--      necesariamente tiene un evento externo detrás del cual derivar una
--      key estable.
--
-- Cambios v5 -> v6 (se mantienen todos, ver más abajo el detalle de cada
-- uno): TODO lo de v3/v4/v5 se mantiene: RLS, GRANTs mínimos,
-- balance+ledger, reserved/disponible, sin saldo negativo, decimales,
-- auth.identities.provider_id, SUB/VIP/MOD separados, profiles_public, XP,
-- redemption transaccional, arquitectura futura de tienda/pagos y de
-- Discord.
--
--   1. `redemption_requests.request_key` ahora es `uuid NOT NULL UNIQUE`
--      (antes opcional). `request_redemption()` exige `p_request_key` (sin
--      default) — el cliente SIEMPRE genera un uuid v4 al iniciar una
--      solicitud y reutiliza la misma key en un reintento. Así, doble
--      clic/retry no puede crear dos solicitudes ni reservar el saldo dos
--      veces, aunque hubiera saldo de sobra para ambas.
--   2. Los handlers de unique_violation de `wallet_apply_transaction()` y
--      `request_redemption()` ya NO se conforman con "existe una fila con
--      esa key, la devuelvo". Antes de devolver nada, revalidan que la
--      fila encontrada representa REALMENTE la misma operación (mismos
--      profile_id/currency_code/type/amount/source/description/metadata/
--      created_by para wallet; mismos user_id/currency_code/amount/
--      requested_item/account_identifier/user_notes/metadata para
--      redemption), usando `IS NOT DISTINCT FROM` para los campos
--      nullable. Si no coincide exactamente, `RAISE EXCEPTION` — nunca se
--      devuelve la fila de otra operación solo porque ganó la carrera del
--      UNIQUE.
--   3. `authenticated` ya NO tiene SELECT completo sobre
--      `redemption_requests`. Se reemplazó por un GRANT de columnas que
--      excluye `admin_notes`, `handled_by`, `discord_notified_at` y
--      `metadata` (estos quedan exclusivamente para `service_role`).
--      Se agregó `user_message` (visible para el usuario) separado de
--      `admin_notes` (solo interno) — `admin_update_redemption_status()`
--      ahora puede escribir ambos por separado. ADEMÁS (extensión propia,
--      no pedida explícitamente pero necesaria para que el punto 3
--      funcione de verdad): `request_redemption()` y
--      `cancel_my_redemption_request()` — las dos funciones que un usuario
--      normal puede invocar — ya NO devuelven la fila completa de
--      `redemption_requests` (eso habría filtrado los mismos campos
--      administrativos por la puerta de atrás, sin pasar por el GRANT de
--      columnas). Ahora devuelven un tipo restringido,
--      `redemption_request_public`, con exactamente los campos que sí
--      debe ver el usuario.
--   4. GCOIN queda técnicamente bloqueado, no solo documentado:
--        - `reward_types.is_active = false` para GCOIN -> cualquier
--          intento de moverlo con `wallet_apply_transaction()` revienta
--          (la función ya validaba `is_active`).
--        - `handle_new_user()` sigue sembrando `wallet_balances` solo para
--          monedas `is_active` -> a un usuario nuevo NO se le crea una
--          fila de GCOIN utilizable (sin tocar el código del trigger,
--          simplemente ya no aplica para GCOIN).
--        - Nueva columna `reward_types.externally_managed` (true SOLO
--          para GCOIN) — marca semántica explícita de "esta moneda vive
--          fuera de Supabase por ahora", distinta de "está deprecada".
--        - `gcoin_leaderboard` deja de otorgarse a `anon`/`authenticated`
--          (solo `service_role`) — no se puede usar como ranking real
--          desde el frontend todavía. Cuando exista el puente
--          tienda-server -> Supabase y se decida activar GCOIN, se agrega
--          de nuevo ese GRANT.
--   5. Todo lo demás de v5 se mantiene sin cambios de fondo.
--
-- Ejecuta este archivo completo en Supabase → SQL Editor → New query → Run.
-- Es la primera ejecución real de este schema — no hay datos previos que
-- proteger, pero el archivo sigue siendo re-ejecutable de forma segura
-- durante el resto de esta fase de desarrollo (ver sección 0).
-- ============================================================================
--
-- ARQUITECTURA — POR QUÉ ESTAS TABLAS (resumen)
--
-- profiles            → identidad del miembro (1:1 con auth.users).
-- reward_types        → catálogo de monedas/recompensas. GCOIN queda
--                        marcado externally_managed + is_active=false: el
--                        saldo real sigue en tienda-server.
-- wallet_balances      → balance total ganado (`balance`) + apartado por
--                        solicitudes pendientes (`reserved`). disponible =
--                        balance - reserved, siempre.
-- wallet_transactions  → ledger insert-only, auditable, idempotente
--                        (idempotency_key).
-- twitch_membership    → SUB/VIP/MOD reales en Twitch AHORA MISMO (separado
--                        de TWITCH_SUB de la wallet). is_subscriber/is_vip/
--                        is_moderator se exponen públicamente vía
--                        profiles_public; el resto no.
-- redemption_requests  → solicitud de canje, con request_key OBLIGATORIO
--                        para idempotencia, campos administrativos nunca
--                        visibles para el usuario.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Modo desarrollo: este archivo se puede volver a correr completo sin
--    fallar. Las VISTAS y el TIPO compuesto se botan y se recrean siempre.
--    Las TABLAS usan `create table if not exists`.
-- ----------------------------------------------------------------------------
drop view if exists public.admin_redemption_requests cascade;
drop view if exists public.wallet_leaderboard cascade;  -- nombre de la v2
drop view if exists public.gcoin_leaderboard  cascade;
drop view if exists public.xp_leaderboard     cascade;
drop view if exists public.profiles_public    cascade;
drop view if exists public.leaderboard        cascade;  -- nombre de la v1
drop type if exists public.redemption_request_public cascade;

drop function if exists public.admin_adjust_gcoins(uuid, integer, text, text, text);
drop table if exists public.gcoin_transactions;

-- ---- RESET TOTAL (opcional, NO se ejecuta por defecto) ----
-- Descomenta estas líneas SOLO si quieres borrar TODO y empezar de cero:
-- drop table if exists public.redemption_requests cascade;
-- drop table if exists public.wallet_transactions cascade;
-- drop table if exists public.wallet_balances cascade;
-- drop table if exists public.twitch_membership cascade;
-- drop table if exists public.reward_types cascade;
-- drop table if exists public.profiles cascade;

-- ----------------------------------------------------------------------------
-- 1. PROFILES
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  twitch_id     text not null unique,
  twitch_login  text not null,
  display_name  text,
  avatar_url    text,
  country_code  text,   -- ISO 3166-1 alpha-2, nullable. Único campo editable por el cliente.
  role          text not null default 'member' check (role in ('member','mod','admin')),
  xp            integer not null default 0 check (xp >= 0),
  level         integer not null default 1 check (level >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_country_code_format check (country_code is null or country_code ~ '^[A-Z]{2}$')
);

create index if not exists idx_profiles_twitch_login on public.profiles (twitch_login);
create index if not exists idx_profiles_level        on public.profiles (level desc);

comment on table public.profiles is 'Identidad del miembro. id = auth.users.id. country_code es ISO 3166-1 alpha-2. NO es de lectura pública — ver vista profiles_public.';

-- ----------------------------------------------------------------------------
-- 2. REWARD_TYPES — catálogo extensible de monedas/recompensas
-- ----------------------------------------------------------------------------
create table if not exists public.reward_types (
  code               text primary key check (code = upper(code)),
  display_name       text not null,
  kind               text not null default 'points' check (kind in ('points','currency','item')),
  decimals           smallint not null default 0 check (decimals between 0 and 2),
  is_redeemable      boolean not null default true,
  is_active          boolean not null default true,
  -- true SOLO para monedas cuyo saldo "oficial" vive fuera de Supabase
  -- (hoy: GCOIN, en tienda-server). wallet_apply_transaction() ya la
  -- bloquea vía is_active=false; esta columna es la marca semántica de
  -- POR QUÉ está inactiva (gestionada externamente, no descontinuada), y
  -- la que se lee para decidir cuándo ya se puede activar de verdad.
  externally_managed boolean not null default false,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now()
);

comment on table public.reward_types is 'Catálogo de tipos de saldo. Agregar una moneda nueva = INSERT aquí. GCOIN: is_active=false + externally_managed=true mientras tienda-server siga siendo la única fuente oficial.';

-- GCOIN: is_active=false (bloquea wallet_apply_transaction y el sembrado
-- de balance en handle_new_user) + externally_managed=true (marca que es
-- "gestionada afuera", no que está deprecada) + is_redeemable=false (no
-- se pide como canje). Nada de esto es automático a menos que tienda-server
-- implemente el puente de sincronización y Geo decida activarla.
insert into public.reward_types (code, display_name, kind, decimals, is_redeemable, is_active, externally_managed, sort_order) values
  ('GCOIN',      'G-Coins',        'points',   0, false, false, true,  10),
  ('VBUCKS',     'V-Bucks',        'currency', 0, true,  true,  false, 20),
  ('OWCOINS',    'Overwatch Coins','currency', 0, true,  true,  false, 30),
  ('PAYPAL_USD', 'PayPal (USD)',   'currency', 2, true,  true,  false, 40),
  ('TWITCH_SUB', 'Subs de Twitch', 'item',     0, true,  true,  false, 50)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 3. WALLET_BALANCES
-- ----------------------------------------------------------------------------
create table if not exists public.wallet_balances (
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  currency_code text not null references public.reward_types(code),
  balance       numeric(14,2) not null default 0 check (balance >= 0),
  reserved      numeric(14,2) not null default 0 check (reserved >= 0),
  updated_at    timestamptz not null default now(),
  primary key (profile_id, currency_code),
  constraint wallet_balances_reserved_le_balance check (reserved <= balance)
);

create index if not exists idx_wallet_balances_currency_rank on public.wallet_balances (currency_code, balance desc);

comment on table public.wallet_balances is 'balance = total ganado; reserved = apartado por solicitudes de canje. disponible = balance - reserved. Se escribe SOLO desde las funciones SECURITY DEFINER de este archivo. GCOIN no tendrá fila aquí mientras is_active=false.';

-- ----------------------------------------------------------------------------
-- 4. WALLET_TRANSACTIONS
-- ----------------------------------------------------------------------------
create table if not exists public.wallet_transactions (
  id              bigint generated always as identity primary key,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  currency_code   text not null references public.reward_types(code),
  type            text not null check (type in ('earn','spend','redeem','adjustment','refund')),
  amount          numeric(14,2) not null,
  source          text,
  description     text,
  metadata        jsonb,
  created_by      uuid references auth.users(id),
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  constraint wallet_tx_amount_nonzero check (amount <> 0),
  constraint wallet_tx_sign_matches_type check (
    (type in ('earn','refund')  and amount > 0) or
    (type in ('spend','redeem') and amount < 0) or
    (type = 'adjustment')
  )
);

create index if not exists idx_wallet_tx_profile_currency on public.wallet_transactions (profile_id, currency_code, created_at desc);
create index if not exists idx_wallet_tx_currency_created  on public.wallet_transactions (currency_code, created_at desc);

comment on table public.wallet_transactions is 'Historial completo, insert-only. type=redeem SOLO se inserta desde admin_update_redemption_status(). idempotency_key evita acreditar dos veces el mismo evento externo.';

-- ----------------------------------------------------------------------------
-- 5. TWITCH_MEMBERSHIP
-- ----------------------------------------------------------------------------
create table if not exists public.twitch_membership (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  twitch_user_id    text not null,
  is_subscriber     boolean not null default false,
  subscription_tier text,
  is_vip            boolean not null default false,
  is_moderator      boolean not null default false,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.twitch_membership is 'SUB/VIP/MOD reales en Twitch ahora mismo — false/null hasta sync real. is_subscriber/is_vip/is_moderator se exponen públicamente (badges) vía profiles_public; twitch_user_id/subscription_tier/last_synced_at NUNCA.';

-- ----------------------------------------------------------------------------
-- 6. REDEMPTION_REQUESTS
--    request_key es OBLIGATORIO (no solo recomendado): sin él,
--    request_redemption() ni siquiera intenta reservar saldo.
--    admin_notes/handled_by/discord_notified_at/metadata son
--    EXCLUSIVAMENTE administrativos (ver GRANTs, sección 18) — user_message
--    es el canal separado para comunicarle algo al usuario (ej. motivo de
--    un rechazo) sin exponer las notas internas.
-- ----------------------------------------------------------------------------
create table if not exists public.redemption_requests (
  id                   bigint generated always as identity primary key,
  user_id              uuid not null references public.profiles(id) on delete cascade,
  currency_code        text not null references public.reward_types(code),
  amount               numeric(14,2) not null check (amount > 0),
  status               text not null default 'pending'
                         check (status in ('pending','approved','delivered','rejected','cancelled')),
  requested_item       text,
  account_identifier   text,   -- Epic username / BattleTag / correo PayPal — NUNCA datos de tarjeta
  user_notes           text,
  admin_notes          text,   -- SOLO administrativo (nunca en el GRANT de authenticated)
  constraint redemption_requests_requested_item_len     check (requested_item     is null or char_length(requested_item)     <= 200),
  constraint redemption_requests_account_identifier_len check (account_identifier is null or char_length(account_identifier) <= 200),
  constraint redemption_requests_user_notes_len         check (user_notes         is null or char_length(user_notes)         <= 1000),
  user_message         text,   -- SÍ visible para el usuario (ej. motivo de rechazo)
  requested_at         timestamptz not null default now(),
  approved_at          timestamptz,
  delivered_at         timestamptz,
  rejected_at          timestamptz,
  cancelled_at         timestamptz,
  handled_by           uuid references auth.users(id),   -- SOLO administrativo
  discord_notified_at  timestamptz,                        -- SOLO administrativo
  request_key          uuid not null unique,               -- OBLIGATORIO, generado por el cliente
  metadata             jsonb,                               -- SOLO administrativo
  updated_at           timestamptz not null default now()
);

create index if not exists idx_redemption_requests_status   on public.redemption_requests (status, requested_at desc);
create index if not exists idx_redemption_requests_user     on public.redemption_requests (user_id, requested_at desc);
create index if not exists idx_redemption_requests_pending_notify on public.redemption_requests (discord_notified_at) where status = 'pending';

comment on table public.redemption_requests is 'Solicitud de canje. request_key obligatorio evita duplicados por doble clic/retry incluso con saldo de sobra. admin_notes/handled_by/discord_notified_at/metadata son solo administrativos; user_message es el canal visible para el usuario.';

-- ----------------------------------------------------------------------------
-- 7. updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_wallet_balances_updated_at on public.wallet_balances;
create trigger trg_wallet_balances_updated_at before update on public.wallet_balances
for each row execute function public.set_updated_at();

drop trigger if exists trg_twitch_membership_updated_at on public.twitch_membership;
create trigger trg_twitch_membership_updated_at before update on public.twitch_membership
for each row execute function public.set_updated_at();

drop trigger if exists trg_redemption_requests_updated_at on public.redemption_requests;
create trigger trg_redemption_requests_updated_at before update on public.redemption_requests
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. Trigger: crear perfil + wallet en 0 (solo monedas is_active) + fila de
--    membership al primer login. Exige Twitch y verifica twitch_id contra
--    auth.identities.provider_id antes de crear nada.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider     text;
  v_twitch_id    text;
  v_login        text;
  v_display_name text;
  v_avatar       text;
  r              record;
begin
  v_provider := new.raw_app_meta_data->>'provider';
  if v_provider is distinct from 'twitch' then
    raise exception 'Signup rechazado: proveedor no soportado (%). Solo se acepta Twitch.', coalesce(v_provider, 'desconocido');
  end if;

  select i.provider_id
  into v_twitch_id
  from auth.identities i
  where i.user_id = new.id and i.provider = 'twitch'
  limit 1;

  if v_twitch_id is null or v_twitch_id = '' then
    v_twitch_id := coalesce(new.raw_user_meta_data->>'provider_id', new.raw_user_meta_data->>'sub');
  end if;

  if v_twitch_id is null or v_twitch_id = '' then
    raise exception 'Signup rechazado: no se pudo verificar el ID de Twitch del usuario';
  end if;

  v_login        := coalesce(new.raw_user_meta_data->>'user_name', new.raw_user_meta_data->>'preferred_username', new.raw_user_meta_data->>'nickname', 'usuario_' || substr(v_twitch_id, 1, 8));
  v_display_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', v_login);
  v_avatar       := coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture');

  insert into public.profiles (id, twitch_id, twitch_login, display_name, avatar_url)
  values (new.id, v_twitch_id, v_login, v_display_name, v_avatar)
  on conflict (id) do nothing;

  insert into public.twitch_membership (profile_id, twitch_user_id)
  values (new.id, v_twitch_id)
  on conflict (profile_id) do nothing;

  -- Solo se siembra balance para monedas is_active. GCOIN (is_active=false
  -- mientras sea externally_managed) queda sin fila utilizable a propósito.
  for r in select code from public.reward_types where is_active loop
    insert into public.wallet_balances (profile_id, currency_code, balance)
    values (new.id, r.code, 0)
    on conflict (profile_id, currency_code) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 9. Protección de campos sensibles de profiles
-- ----------------------------------------------------------------------------
create or replace function public.protect_sensitive_profile_fields()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.id            is distinct from old.id
     or new.display_name  is distinct from old.display_name
     or new.avatar_url    is distinct from old.avatar_url
     or new.twitch_id     is distinct from old.twitch_id
     or new.twitch_login  is distinct from old.twitch_login
     or new.xp            is distinct from old.xp
     or new.level         is distinct from old.level
     or new.role          is distinct from old.role
     or new.created_at    is distinct from old.created_at then
    raise exception 'Desde el cliente solo se puede modificar el campo country_code del perfil';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_fields on public.profiles;
create trigger trg_protect_profile_fields before update on public.profiles
for each row execute function public.protect_sensitive_profile_fields();

-- ----------------------------------------------------------------------------
-- 10. Validación de transacciones de wallet (decimales + moneda activa),
--     segunda capa además de la validación explícita en
--     wallet_apply_transaction().
-- ----------------------------------------------------------------------------
create or replace function public.validate_wallet_transaction()
returns trigger language plpgsql as $$
declare
  v_decimals smallint;
  v_active   boolean;
begin
  select decimals, is_active into v_decimals, v_active
  from public.reward_types
  where code = new.currency_code;

  if v_decimals is null then
    raise exception 'Moneda/recompensa desconocida: %', new.currency_code;
  end if;
  if not v_active then
    raise exception 'Moneda/recompensa inactiva: %', new.currency_code;
  end if;
  if round(new.amount, v_decimals) <> new.amount then
    raise exception 'El monto % no respeta los % decimales permitidos para %', new.amount, v_decimals, new.currency_code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_wallet_transaction on public.wallet_transactions;
create trigger trg_validate_wallet_transaction
before insert on public.wallet_transactions
for each row execute function public.validate_wallet_transaction();

-- ----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.reward_types        enable row level security;
alter table public.wallet_balances     enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.twitch_membership   enable row level security;
alter table public.redemption_requests enable row level security;

drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "reward_types_select_public" on public.reward_types;
create policy "reward_types_select_public" on public.reward_types
for select using (true);

drop policy if exists "wallet_balances_select_own" on public.wallet_balances;
create policy "wallet_balances_select_own" on public.wallet_balances
for select using (auth.uid() = profile_id);

drop policy if exists "wallet_tx_select_own" on public.wallet_transactions;
create policy "wallet_tx_select_own" on public.wallet_transactions
for select using (auth.uid() = profile_id);

drop policy if exists "twitch_membership_select_own" on public.twitch_membership;
create policy "twitch_membership_select_own" on public.twitch_membership
for select using (auth.uid() = profile_id);

-- redemption_requests: la policy sigue restringiendo FILAS (cada quien ve
-- solo las suyas). Qué COLUMNAS puede ver dentro de esas filas lo deciden
-- los GRANTs de la sección 18, no esta policy.
drop policy if exists "redemption_requests_select_own" on public.redemption_requests;
create policy "redemption_requests_select_own" on public.redemption_requests
for select using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 12. Vistas y tipo compuesto
-- ----------------------------------------------------------------------------
create view public.profiles_public as
select
  p.id,
  p.twitch_login,
  p.display_name,
  p.avatar_url,
  p.level,
  p.xp,
  p.country_code,
  coalesce(tm.is_subscriber, false) as is_subscriber,
  coalesce(tm.is_vip, false)        as is_vip,
  coalesce(tm.is_moderator, false)  as is_moderator
from public.profiles p
left join public.twitch_membership tm on tm.profile_id = p.id;

comment on view public.profiles_public is 'Único subconjunto público de profiles+twitch_membership. Nunca expone twitch_id, role, created_at, twitch_user_id, subscription_tier, last_synced_at.';

-- GCOIN es externally_managed (is_active=false): esta vista existirá pero
-- estará vacía (nadie tiene fila de wallet_balances en GCOIN todavía) y NO
-- se otorga a anon/authenticated (ver sección 18) — no se puede usar como
-- ranking real hasta activar GCOIN de verdad.
create view public.gcoin_leaderboard as
select
  b.profile_id,
  pp.twitch_login,
  pp.display_name,
  pp.avatar_url,
  pp.level,
  pp.country_code,
  pp.is_subscriber,
  pp.is_vip,
  pp.is_moderator,
  b.balance,
  row_number() over (order by b.balance desc) as rank
from public.wallet_balances b
join public.profiles_public pp on pp.id = b.profile_id
where b.currency_code = 'GCOIN';

comment on view public.gcoin_leaderboard is 'Ranking de GCOIN. NO otorgado a anon/authenticated todavía — GCOIN es externally_managed y esta vista está vacía mientras tanto. Ver sección 18 para reactivarlo.';

create view public.xp_leaderboard as
select
  pp.id as profile_id,
  pp.twitch_login,
  pp.display_name,
  pp.avatar_url,
  pp.level,
  pp.xp,
  pp.country_code,
  pp.is_subscriber,
  pp.is_vip,
  pp.is_moderator,
  row_number() over (order by pp.xp desc) as rank
from public.profiles_public pp;

create view public.admin_redemption_requests as
select
  r.*,
  p.twitch_login,
  p.display_name,
  p.avatar_url
from public.redemption_requests r
join public.profiles p on p.id = r.user_id;

comment on view public.admin_redemption_requests is 'SOLO para el backend/panel admin (service_role). Expone TODAS las solicitudes de TODOS los usuarios, incluidos los campos administrativos — jamás otorgar SELECT aquí a anon/authenticated.';

-- Tipo restringido que devuelven request_redemption()/
-- cancel_my_redemption_request() a un usuario normal: exactamente los
-- campos que un miembro debe poder ver de su propia solicitud. NUNCA
-- incluye admin_notes/handled_by/discord_notified_at/metadata — si esas
-- funciones devolvieran la fila completa (public.redemption_requests),
-- el GRANT de columnas de la sección 18 quedaría de adorno, porque el
-- valor de retorno de una función no pasa por ese control.
create type public.redemption_request_public as (
  id                 bigint,
  currency_code      text,
  amount             numeric,
  status             text,
  requested_item     text,
  account_identifier text,
  user_notes         text,
  user_message       text,
  requested_at       timestamptz,
  approved_at        timestamptz,
  delivered_at       timestamptz,
  rejected_at        timestamptz,
  cancelled_at       timestamptz,
  updated_at         timestamptz
);

-- ----------------------------------------------------------------------------
-- 13. WALLET_APPLY_TRANSACTION — earn/spend/adjustment/refund (NO redeem).
--     SOLO backend. Valida decimales antes de tocar numeric(14,2), nunca
--     deja balance negativo ni por debajo de lo reservado, y soporta
--     idempotency_key con revalidación estricta de que es la MISMA
--     operación antes de devolver una fila existente.
--
--     `p_idempotency_key` es OBLIGATORIO para cualquier `p_type` que no
--     sea `adjustment`: earn/spend/refund son, por diseño, los tipos que
--     dispara un evento automático (Streamer.bot, Gacha, un futuro sync
--     de GCOIN), y ese evento SIEMPRE tiene (o puede generar) una key
--     estable — si llega dos veces, no debe acreditar/debitar dos veces.
--     `adjustment` es la única excepción: es exactamente el tipo
--     reservado para una corrección manual de un admin (ej. desde el SQL
--     Editor o un futuro panel), que no necesariamente tiene un evento
--     externo del cual derivar una key, y no se quiere poner esa fricción
--     a un ajuste administrativo legítimo.
-- ----------------------------------------------------------------------------
create or replace function public.wallet_apply_transaction(
  p_profile_id      uuid,
  p_currency_code   text,
  p_amount          numeric,
  p_type            text,
  p_source          text default null,
  p_description     text default null,
  p_metadata        jsonb default null,
  p_created_by      uuid default null,
  p_idempotency_key text default null
) returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx               public.wallet_transactions;
  v_existing         public.wallet_transactions;
  v_current_balance  numeric(14,2);
  v_current_reserved numeric(14,2);
  v_new_balance      numeric(14,2);
  v_decimals         smallint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el backend (service role) puede mover saldos de wallet';
  end if;
  if p_type not in ('earn','spend','adjustment','refund') then
    raise exception 'Tipo de transacción inválido para wallet_apply_transaction: % (redeem se genera SOLO desde admin_update_redemption_status)', p_type;
  end if;
  if p_type <> 'adjustment' and p_idempotency_key is null then
    raise exception 'idempotency_key es obligatorio para type=% (solo type=adjustment, corrección manual de un admin, puede omitirlo)', p_type;
  end if;
  if p_amount = 0 then
    raise exception 'El monto de una transacción no puede ser 0';
  end if;

  select decimals into v_decimals
  from public.reward_types
  where code = p_currency_code and is_active;
  if v_decimals is null then
    raise exception 'Moneda/recompensa inválida o inactiva: % (si es GCOIN: sigue externally_managed, ver reward_types.externally_managed)', p_currency_code;
  end if;
  if round(p_amount, v_decimals) <> p_amount then
    raise exception 'El monto % no respeta los % decimales permitidos para %', p_amount, v_decimals, p_currency_code;
  end if;

  -- Idempotencia: se revalida que la fila encontrada sea REALMENTE la
  -- misma operación antes de devolverla. IS NOT DISTINCT FROM para que
  -- los campos nullable (source/description/metadata/created_by) comparen
  -- correctamente cuando ambos lados son null.
  if p_idempotency_key is not null then
    select * into v_existing from public.wallet_transactions where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.profile_id    is not distinct from p_profile_id
         and v_existing.currency_code is not distinct from p_currency_code
         and v_existing.type          is not distinct from p_type
         and v_existing.amount        is not distinct from p_amount
         and v_existing.source        is not distinct from p_source
         and v_existing.description   is not distinct from p_description
         and v_existing.metadata      is not distinct from p_metadata
         and v_existing.created_by    is not distinct from p_created_by
      then
        return v_existing;
      else
        raise exception 'idempotency_key % ya fue usado para una transacción distinta', p_idempotency_key;
      end if;
    end if;
  end if;
  -- (este primer chequeo es un atajo rápido antes de tomar el lock; el
  -- recheck decisivo, el que de verdad cierra la carrera, es el que viene
  -- justo después del `for update` más abajo)

  insert into public.wallet_balances (profile_id, currency_code, balance)
  values (p_profile_id, p_currency_code, 0)
  on conflict (profile_id, currency_code) do nothing;

  select balance, reserved into v_current_balance, v_current_reserved
  from public.wallet_balances
  where profile_id = p_profile_id and currency_code = p_currency_code
  for update;

  -- Recheck de idempotencia DESPUÉS de tomar el lock del wallet: otra
  -- llamada concurrente con la misma idempotency_key pudo haber terminado
  -- (insertado su transacción y actualizado el balance) justo mientras
  -- esperábamos este lock. Sin este recheck, aquí veríamos el balance ya
  -- modificado por esa otra llamada y podríamos lanzar "saldo insuficiente"
  -- ANTES de llegar al INSERT que detectaría la key duplicada — rompiendo
  -- la semántica de idempotencia de un retry idéntico.
  if p_idempotency_key is not null then
    select * into v_existing from public.wallet_transactions where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.profile_id    is not distinct from p_profile_id
         and v_existing.currency_code is not distinct from p_currency_code
         and v_existing.type          is not distinct from p_type
         and v_existing.amount        is not distinct from p_amount
         and v_existing.source        is not distinct from p_source
         and v_existing.description   is not distinct from p_description
         and v_existing.metadata      is not distinct from p_metadata
         and v_existing.created_by    is not distinct from p_created_by
      then
        return v_existing;
      else
        raise exception 'idempotency_key % ya fue usado para una transacción distinta (detectado tras el lock del wallet)', p_idempotency_key;
      end if;
    end if;
  end if;

  v_new_balance := v_current_balance + p_amount;

  if v_new_balance < 0 then
    raise exception 'Saldo insuficiente: % % actual + (%) dejaría el balance en % (negativo). Operación rechazada, nada se modifica.',
      v_current_balance, p_currency_code, p_amount, v_new_balance;
  end if;
  if v_new_balance < v_current_reserved then
    raise exception 'No se puede dejar el balance de % en % porque ya hay % reservado en solicitudes de canje pendientes/aprobadas.',
      p_currency_code, v_new_balance, v_current_reserved;
  end if;

  begin
    insert into public.wallet_transactions
      (profile_id, currency_code, type, amount, source, description, metadata, created_by, idempotency_key)
    values
      (p_profile_id, p_currency_code, p_type, p_amount, p_source, p_description, p_metadata, p_created_by, p_idempotency_key)
    returning * into v_tx;
  exception
    when unique_violation then
      -- Carrera: dos llamadas concurrentes con la misma idempotency_key.
      -- Se revalida igual que arriba antes de devolver la fila ganadora.
      if p_idempotency_key is not null then
        select * into v_tx from public.wallet_transactions where idempotency_key = p_idempotency_key;
        if found
           and v_tx.profile_id    is not distinct from p_profile_id
           and v_tx.currency_code is not distinct from p_currency_code
           and v_tx.type          is not distinct from p_type
           and v_tx.amount        is not distinct from p_amount
           and v_tx.source        is not distinct from p_source
           and v_tx.description   is not distinct from p_description
           and v_tx.metadata      is not distinct from p_metadata
           and v_tx.created_by    is not distinct from p_created_by
        then
          return v_tx;
        end if;
      end if;
      raise exception 'idempotency_key % en conflicto con una transacción distinta (carrera detectada)', p_idempotency_key;
  end;

  update public.wallet_balances
    set balance = v_new_balance, updated_at = now()
    where profile_id = p_profile_id and currency_code = p_currency_code;

  return v_tx;
end;
$$;

comment on function public.wallet_apply_transaction is 'Único camino para earn/spend/adjustment/refund (NO redeem, NO GCOIN mientras sea externally_managed). idempotency_key OBLIGATORIO salvo para type=adjustment (corrección manual). Revalidación estricta antes de reutilizar una fila existente. Solo callable con la Service Role Key.';

-- ----------------------------------------------------------------------------
-- 14. XP / Nivel — separado de la wallet, solo backend
-- ----------------------------------------------------------------------------
create or replace function public.xp_to_level(p_xp integer)
returns integer language sql immutable as $$
  select greatest(1, (p_xp / 1000) + 1);
$$;

create or replace function public.admin_add_xp(
  p_profile_id uuid,
  p_amount     integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_xp integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el backend (service role) puede otorgar XP';
  end if;

  update public.profiles
    set xp = greatest(xp + p_amount, 0)
    where id = p_profile_id
    returning xp into v_new_xp;

  update public.profiles
    set level = public.xp_to_level(v_new_xp)
    where id = p_profile_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15. REQUEST_REDEMPTION — el usuario autenticado pide un premio ganado.
--     `p_request_key` es OBLIGATORIO (sin default): el cliente genera un
--     uuid v4 al iniciar la solicitud y reutiliza la misma key en un
--     reintento. Devuelve `redemption_request_public` (NUNCA la fila
--     completa) para no filtrar campos administrativos por la puerta de
--     atrás.
-- ----------------------------------------------------------------------------
create or replace function public.request_redemption(
  p_currency_code      text,
  p_amount             numeric,
  p_request_key        uuid,
  p_requested_item     text default null,
  p_account_identifier text default null,
  p_user_notes         text default null
) returns public.redemption_request_public
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_decimals   smallint;
  v_active     boolean;
  v_redeemable boolean;
  v_balance    numeric(14,2);
  v_reserved   numeric(14,2);
  v_available  numeric(14,2);
  v_req        public.redemption_requests;
  v_existing   public.redemption_requests;
  v_out        public.redemption_request_public;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para solicitar una recompensa';
  end if;
  if p_request_key is null then
    raise exception 'request_key es obligatorio (genera un uuid en el cliente y reutilízalo si reintentas)';
  end if;
  -- Límites de longitud: rechazados aquí con un mensaje claro ANTES de
  -- tocar balances (los mismos límites están también como CHECK en la
  -- tabla, por si algo insertara por otra vía).
  if p_requested_item is not null and char_length(p_requested_item) > 200 then
    raise exception 'requested_item no puede superar 200 caracteres (recibido: %)', char_length(p_requested_item);
  end if;
  if p_account_identifier is not null and char_length(p_account_identifier) > 200 then
    raise exception 'account_identifier no puede superar 200 caracteres (recibido: %)', char_length(p_account_identifier);
  end if;
  if p_user_notes is not null and char_length(p_user_notes) > 1000 then
    raise exception 'user_notes no puede superar 1000 caracteres (recibido: %)', char_length(p_user_notes);
  end if;

  -- Idempotencia: si ya existe una solicitud con este request_key, se
  -- revalida que sea REALMENTE la misma solicitud antes de devolverla —
  -- nunca se devuelve la fila de otra operación solo porque coincide la
  -- key. `metadata` queda fuera de esta comparación a propósito: un
  -- usuario authenticated ya no puede escribirla (es exclusivamente
  -- backend/admin), así que nunca puede ser parte de "lo que el cliente
  -- pidió".
  select * into v_existing from public.redemption_requests where request_key = p_request_key;
  if found then
    if v_existing.user_id             is not distinct from v_uid
       and v_existing.currency_code     is not distinct from p_currency_code
       and v_existing.amount            is not distinct from p_amount
       and v_existing.requested_item    is not distinct from p_requested_item
       and v_existing.account_identifier is not distinct from p_account_identifier
       and v_existing.user_notes        is not distinct from p_user_notes
    then
      v_req := v_existing;
    else
      raise exception 'request_key % ya fue usado para una solicitud distinta', p_request_key;
    end if;
  else
    -- (este primer chequeo es un atajo rápido antes de tomar el lock del
    -- wallet; el recheck decisivo, el que de verdad cierra la carrera, es
    -- el que viene justo después del `for update` más abajo)
    if p_amount is null or p_amount <= 0 then
      raise exception 'El monto solicitado debe ser mayor a 0';
    end if;

    select decimals, is_active, is_redeemable into v_decimals, v_active, v_redeemable
    from public.reward_types where code = p_currency_code;

    if v_decimals is null or not v_active then
      raise exception 'Moneda/recompensa inválida o inactiva: %', p_currency_code;
    end if;
    if not v_redeemable then
      raise exception '% no se puede canjear como solicitud de recompensa', p_currency_code;
    end if;
    if round(p_amount, v_decimals) <> p_amount then
      raise exception 'El monto % no respeta los % decimales permitidos para %', p_amount, v_decimals, p_currency_code;
    end if;

    select balance, reserved into v_balance, v_reserved
    from public.wallet_balances
    where profile_id = v_uid and currency_code = p_currency_code
    for update;

    -- Recheck de idempotencia DESPUÉS de tomar el lock del wallet: otra
    -- llamada concurrente con el mismo request_key pudo haber terminado
    -- (reservado el saldo y creado la solicitud) justo mientras
    -- esperábamos este lock. Sin este recheck, aquí veríamos el saldo ya
    -- reservado por esa otra llamada y podríamos lanzar "saldo
    -- insuficiente" ANTES de llegar al INSERT que detectaría la key
    -- duplicada — rompiendo la semántica de idempotencia de un retry
    -- idéntico. Mismo criterio de comparación que el primer chequeo.
    select * into v_existing from public.redemption_requests where request_key = p_request_key;
    if found then
      if v_existing.user_id             is not distinct from v_uid
         and v_existing.currency_code     is not distinct from p_currency_code
         and v_existing.amount            is not distinct from p_amount
         and v_existing.requested_item    is not distinct from p_requested_item
         and v_existing.account_identifier is not distinct from p_account_identifier
         and v_existing.user_notes        is not distinct from p_user_notes
      then
        v_req := v_existing;
      else
        raise exception 'request_key % ya fue usado para una solicitud distinta (detectado tras el lock del wallet)', p_request_key;
      end if;
    else
      if v_balance is null then
        raise exception 'No tienes saldo de % todavía', p_currency_code;
      end if;

      v_available := v_balance - v_reserved;
      if p_amount > v_available then
        raise exception 'Saldo disponible insuficiente: disponible % %, solicitado %', v_available, p_currency_code, p_amount;
      end if;

      update public.wallet_balances
        set reserved = reserved + p_amount, updated_at = now()
        where profile_id = v_uid and currency_code = p_currency_code;

      -- metadata NO se pasa aquí: queda null en el insert. Solo el backend
      -- (admin_update_redemption_status u otra vía de service_role) puede
      -- llenarla más adelante.
      begin
        insert into public.redemption_requests
          (user_id, currency_code, amount, status, requested_item, account_identifier, user_notes, request_key)
        values
          (v_uid, p_currency_code, p_amount, 'pending', p_requested_item, p_account_identifier, p_user_notes, p_request_key)
        returning * into v_req;
      exception
        when unique_violation then
          -- Última defensa: para carreras que el lock del wallet no
          -- alcanza a cubrir (ej. si por algún motivo dos llamadas no
          -- terminaran serializadas por el mismo profile+currency) u
          -- otros casos límite. Otra llamada concurrente insertó primero
          -- con el mismo request_key: deshace la reserva que acabamos de
          -- aplicar y usa la fila ganadora — pero SOLO si de verdad es la
          -- misma solicitud.
          update public.wallet_balances
            set reserved = reserved - p_amount, updated_at = now()
            where profile_id = v_uid and currency_code = p_currency_code;

          select * into v_existing from public.redemption_requests where request_key = p_request_key;
          if found
             and v_existing.user_id             is not distinct from v_uid
             and v_existing.currency_code     is not distinct from p_currency_code
             and v_existing.amount            is not distinct from p_amount
             and v_existing.requested_item    is not distinct from p_requested_item
             and v_existing.account_identifier is not distinct from p_account_identifier
             and v_existing.user_notes        is not distinct from p_user_notes
          then
            v_req := v_existing;
          else
            raise exception 'request_key % en conflicto con una solicitud distinta (carrera detectada)', p_request_key;
          end if;
      end;
    end if;
  end if;

  select v_req.id, v_req.currency_code, v_req.amount, v_req.status,
         v_req.requested_item, v_req.account_identifier, v_req.user_notes,
         v_req.user_message, v_req.requested_at, v_req.approved_at,
         v_req.delivered_at, v_req.rejected_at, v_req.cancelled_at,
         v_req.updated_at
  into v_out;

  return v_out;
end;
$$;

comment on function public.request_redemption is 'El usuario pide un premio ganado. request_key OBLIGATORIO: doble clic/retry con la misma key nunca crea dos solicitudes ni reserva dos veces. Ya NO acepta metadata (exclusivo backend). Límites de longitud en requested_item/account_identifier (200)/user_notes (1000). Devuelve redemption_request_public (nunca la fila completa).';

-- ----------------------------------------------------------------------------
-- 16. CANCEL_MY_REDEMPTION_REQUEST — el propio usuario cancela su propia
--     solicitud mientras siga pending. Devuelve redemption_request_public.
-- ----------------------------------------------------------------------------
create or replace function public.cancel_my_redemption_request(p_request_id bigint)
returns public.redemption_request_public
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.redemption_requests;
  v_out public.redemption_request_public;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;

  select * into v_req
  from public.redemption_requests
  where id = p_request_id
  for update;

  if v_req is null then
    raise exception 'Solicitud no encontrada';
  end if;
  if v_req.user_id <> v_uid then
    raise exception 'No puedes cancelar una solicitud que no es tuya';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Solo se puede cancelar una solicitud mientras está pending (estado actual: %)', v_req.status;
  end if;

  update public.wallet_balances
    set reserved = reserved - v_req.amount, updated_at = now()
    where profile_id = v_req.user_id and currency_code = v_req.currency_code;

  update public.redemption_requests
    set status = 'cancelled', cancelled_at = now()
    where id = p_request_id
    returning * into v_req;

  select v_req.id, v_req.currency_code, v_req.amount, v_req.status,
         v_req.requested_item, v_req.account_identifier, v_req.user_notes,
         v_req.user_message, v_req.requested_at, v_req.approved_at,
         v_req.delivered_at, v_req.rejected_at, v_req.cancelled_at,
         v_req.updated_at
  into v_out;

  return v_out;
end;
$$;

-- ----------------------------------------------------------------------------
-- 17. ADMIN_UPDATE_REDEMPTION_STATUS — SOLO backend/service_role. Aprobar,
--     rechazar, cancelar o entregar. Acepta `p_user_message` (visible para
--     el usuario, ej. motivo de rechazo) separado de `p_admin_notes`
--     (solo interno). Devuelve la fila COMPLETA (public.redemption_requests)
--     — aceptable porque esta función es exclusivamente para el backend
--     administrativo, no para el usuario final.
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_redemption_status(
  p_request_id  bigint,
  p_new_status  text,
  p_admin_notes text default null,
  p_handled_by  uuid default null,
  p_user_message text default null
) returns public.redemption_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.redemption_requests;
  v_tx  public.wallet_transactions;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el backend (service role) puede administrar solicitudes de canje';
  end if;
  if p_new_status not in ('approved','delivered','rejected','cancelled') then
    raise exception 'Estado destino inválido: %', p_new_status;
  end if;

  select * into v_req
  from public.redemption_requests
  where id = p_request_id
  for update;

  if v_req is null then
    raise exception 'Solicitud no encontrada';
  end if;
  if v_req.status not in ('pending','approved') then
    raise exception 'Esta solicitud ya fue resuelta (estado actual: %) y no se puede modificar', v_req.status;
  end if;
  if p_new_status = 'approved' and v_req.status <> 'pending' then
    raise exception 'Solo se puede aprobar una solicitud en estado pending';
  end if;

  if p_new_status = 'delivered' then
    update public.wallet_balances
      set balance  = balance - v_req.amount,
          reserved = reserved - v_req.amount,
          updated_at = now()
      where profile_id = v_req.user_id and currency_code = v_req.currency_code;

    insert into public.wallet_transactions
      (profile_id, currency_code, type, amount, source, description, metadata, created_by)
    values
      (v_req.user_id, v_req.currency_code, 'redeem', -v_req.amount, 'redemption',
       coalesce(v_req.requested_item, 'Canje de recompensa'),
       jsonb_build_object('redemption_request_id', v_req.id),
       p_handled_by)
    returning * into v_tx;

    update public.redemption_requests
      set status = 'delivered', delivered_at = now(), handled_by = p_handled_by,
          admin_notes = coalesce(p_admin_notes, admin_notes),
          user_message = coalesce(p_user_message, user_message)
      where id = p_request_id
      returning * into v_req;

  elsif p_new_status in ('rejected','cancelled') then
    update public.wallet_balances
      set reserved = reserved - v_req.amount, updated_at = now()
      where profile_id = v_req.user_id and currency_code = v_req.currency_code;

    update public.redemption_requests
      set status = p_new_status,
          rejected_at  = case when p_new_status = 'rejected'  then now() else rejected_at  end,
          cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end,
          handled_by = p_handled_by,
          admin_notes = coalesce(p_admin_notes, admin_notes),
          user_message = coalesce(p_user_message, user_message)
      where id = p_request_id
      returning * into v_req;

  else -- approved
    update public.redemption_requests
      set status = 'approved', approved_at = now(), handled_by = p_handled_by,
          admin_notes = coalesce(p_admin_notes, admin_notes),
          user_message = coalesce(p_user_message, user_message)
      where id = p_request_id
      returning * into v_req;
  end if;

  return v_req;
end;
$$;

comment on function public.admin_update_redemption_status is 'Único camino administrativo. p_user_message (visible al usuario) es independiente de p_admin_notes (solo interno). Solo debita balance real + registra el ÚNICO redeem posible al pasar a delivered. Solo callable con la Service Role Key.';

-- ============================================================================
-- 18. GRANTS explícitos para la Data API (PostgREST)
-- "Automatically expose new tables" está DESACTIVADO — todo GRANT es
-- explícito. RLS decide QUÉ FILAS; estos GRANTs deciden qué operación (y,
-- en redemption_requests, qué COLUMNAS) puede intentar cada rol.
-- ============================================================================
grant usage on schema public to anon, authenticated, service_role;

grant select on public.profiles to authenticated;
grant update (country_code) on public.profiles to authenticated;
grant select, update, delete on public.profiles to service_role;

grant select on public.reward_types to anon, authenticated;
grant select, insert, update on public.reward_types to service_role;

grant select on public.wallet_balances to authenticated;
grant select on public.wallet_balances to service_role;

grant select on public.wallet_transactions to authenticated;
grant select on public.wallet_transactions to service_role;

grant select on public.twitch_membership to authenticated;
grant select on public.twitch_membership to service_role;

-- redemption_requests: authenticated SOLO ve estas columnas (incluye
-- user_id porque la policy de RLS lo necesita para filtrar, aunque el
-- frontend no tenga por qué mostrarlo) — NUNCA admin_notes/handled_by/
-- discord_notified_at/metadata/request_key, ni siquiera en su propia fila.
grant select (
  id, user_id, currency_code, amount, status, requested_item,
  account_identifier, user_notes, user_message,
  requested_at, approved_at, delivered_at, rejected_at, cancelled_at, updated_at
) on public.redemption_requests to authenticated;
grant select on public.redemption_requests to service_role;
grant update (discord_notified_at) on public.redemption_requests to service_role;

grant select on public.profiles_public to anon, authenticated;
grant select on public.xp_leaderboard  to anon, authenticated;

-- gcoin_leaderboard: SOLO service_role por ahora (ver sección 12 y punto 4
-- de las notas iniciales). Cuando GCOIN deje de ser externally_managed,
-- agregar aquí: grant select on public.gcoin_leaderboard to anon, authenticated;
grant select on public.gcoin_leaderboard to service_role;

grant select on public.admin_redemption_requests to service_role;

revoke execute on function public.wallet_apply_transaction from public;
grant  execute on function public.wallet_apply_transaction to service_role;

revoke execute on function public.admin_add_xp from public;
grant  execute on function public.admin_add_xp to service_role;

revoke execute on function public.xp_to_level from public;
grant  execute on function public.xp_to_level to service_role;

revoke execute on function public.request_redemption from public;
grant  execute on function public.request_redemption to authenticated;

revoke execute on function public.cancel_my_redemption_request from public;
grant  execute on function public.cancel_my_redemption_request to authenticated;

revoke execute on function public.admin_update_redemption_status from public;
grant  execute on function public.admin_update_redemption_status to service_role;

-- ============================================================================
-- 19. ARQUITECTURA FUTURA DE TIENDA / PAGOS — NO IMPLEMENTADA. Ninguna
--     tabla de esta sección existe todavía en la base de datos.
--
-- La wallet representa CRÉDITO GANADO dentro de Geo Army. Una compra en la
-- tienda representa DINERO REAL vía una pasarela externa. Nunca se suman
-- automáticamente.
--
-- Tablas previstas (orientativo):
--   products      (id, name, description, currency_equivalent_code,
--                  currency_equivalent_amount, price_usd_cents, is_active,
--                  metadata, created_at)
--   orders        (id, user_id -> profiles(id), status, total_usd_cents,
--                  currency, created_at, updated_at)
--                 status: pending_payment | paid | fulfillment_pending |
--                         delivered | cancelled | refunded
--   order_items   (id, order_id -> orders(id), product_id -> products(id),
--                  quantity, unit_price_usd_cents, metadata)
--   payments      (id, order_id -> orders(id), provider ['stripe', ...],
--                  external_payment_id, amount_usd_cents, currency, status,
--                  created_at, updated_at)
--                 -- Supabase JAMÁS almacena número de tarjeta, CVV, fecha
--                 -- de expiración ni secretos del proveedor. Solo la
--                 -- referencia (external_payment_id) y el estado.
--   fulfillments  (id, order_id -> orders(id), status, delivered_at,
--                  handled_by -> auth.users(id), notes, metadata)
--
-- Camino abierto a futuro (NO implementar todavía): un order_item con
-- `wallet_contribution_currency_code` + `wallet_contribution_amount`
-- opcionales, que en checkout llamarían a un equivalente de
-- wallet_apply_transaction() (type='spend') para descontar esa parte de
-- la wallet, cobrando el resto vía payments/Stripe.
--
-- Discord (futuro, NO implementado): `redemption_requests.discord_notified_at`
-- ya existe como el "gancho" — un job/webhook futuro puede hacer
-- `where status='pending' and discord_notified_at is null` para saber qué
-- avisar. Sin secrets de Discord en este archivo ni en el frontend.
-- ============================================================================
