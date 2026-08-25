-- ============================================================================
-- MIGRACIÓN v2 — Panel admin de recompensas (redemption_requests), 2026-08-24
-- Pega y corre esto completo en el SQL Editor de Supabase. Es aditiva: no
-- borra ni renombra nada de tu schema.sql actual (v8). Requiere que tu
-- proyecto ya tenga ejecutado ese schema.sql completo antes.
-- Si ya corriste migracion-panel-admin.sql (v1), este archivo la reemplaza
-- por completo (create or replace + grants explícitos) — puedes correrlo
-- encima sin problema, es idempotente.
-- ============================================================================

-- 20. MIGRACIÓN — Panel admin de recompensas (agregado 2026-08-24)
-- Aditiva: no borra ni renombra nada de las secciones anteriores. Objetivo:
-- permitir que un perfil con profiles.role = 'admin' liste y resuelva
-- redemption_requests DESDE EL FRONTEND (no solo desde service_role), con el
-- enforcement real dentro de estas funciones SECURITY DEFINER — nunca
-- confiando en ocultar botones en la web. profiles.role sigue siendo
-- intocable por el propio cliente (protect_sensitive_profile_fields, sección
-- 9, sin cambios): solo se asigna manualmente por SQL Editor.
-- ============================================================================

create or replace function public.admin_list_redemption_requests(p_status text default 'pending')
returns table (
  id                 bigint,
  user_id            uuid,
  twitch_login       text,
  display_name       text,
  avatar_url         text,
  currency_code      text,
  amount             numeric,
  status             text,
  requested_item     text,
  account_identifier text,
  user_notes         text,
  requested_at       timestamptz,
  approved_at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- OJO: esta función tiene una columna de salida llamada "id" (por el
  -- RETURNS TABLE de más abajo), así que dentro del cuerpo "id" a secas es
  -- ambiguo (Postgres no sabe si es esa variable de salida o profiles.id).
  -- Por eso se usa el alias "adm" explícito, no "where id = auth.uid()".
  if auth.role() <> 'service_role'
     and not exists (select 1 from public.profiles adm where adm.id = auth.uid() and adm.role = 'admin')
  then
    raise exception 'Solo un administrador o el backend (service role) puede ver el panel de solicitudes';
  end if;

  return query
  select r.id, r.user_id, p.twitch_login, p.display_name, p.avatar_url,
         r.currency_code, r.amount, r.status, r.requested_item,
         r.account_identifier, r.user_notes, r.requested_at, r.approved_at
  from public.redemption_requests r
  join public.profiles p on p.id = r.user_id
  where p_status is null or r.status = p_status
  order by r.requested_at asc;
end;
$$;

comment on function public.admin_list_redemption_requests is 'Lista de solicitudes para el panel admin, con datos de usuario ya unidos (twitch_login/display_name/avatar_url de profiles, NUNCA campos administrativos). Requiere profiles.role = admin del propio auth.uid() O service_role — si no, lanza excepción. p_status=null trae todas.';

revoke execute on function public.admin_list_redemption_requests from public;
grant  execute on function public.admin_list_redemption_requests to authenticated;
grant  execute on function public.admin_list_redemption_requests to service_role;

-- admin_update_redemption_status (sección 17): se amplía el guard de
-- autorización para aceptar TAMBIÉN a un usuario autenticado con
-- profiles.role = 'admin' (antes: solo service_role). handled_by ya NO se
-- confía como parámetro del cliente cuando quien llama es un admin
-- autenticado — se fuerza a auth.uid(), para que nadie pueda atribuir una
-- acción a otro admin. El comportamiento para service_role no cambia.
--
-- v2 (ajustes pedidos por Geo tras revisar v1):
--   1) Flujo de estados más estricto: approved SOLO desde pending; delivered
--      SOLO desde approved (ya no se puede pasar pending -> delivered de
--      un salto); rejected sigue permitido desde pending o approved;
--      cancelled se deja igual que antes (pending o approved), por si el
--      admin lo sigue necesitando.
--   2) Cada UPDATE a wallet_balances se verifica con GET DIAGNOSTICS
--      ROW_COUNT: si no afectó EXACTAMENTE 1 fila, se lanza una excepción y
--      toda la operación (incluido el cambio de estado de la solicitud) se
--      revierte — nunca queda una solicitud en delivered/rejected/cancelled
--      si la wallet no se pudo tocar de verdad. Los CHECK constraints de
--      wallet_balances (reserved <= balance, balance >= 0, reserved >= 0)
--      se mantienen intactos como segunda capa de defensa: si el ROW_COUNT
--      da 1 pero el resultado numérico fuera inválido, el propio UPDATE ya
--      habría fallado por el constraint antes de llegar al chequeo.
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
  v_handled_by uuid;
  v_rows_affected integer;
begin
  if auth.role() = 'service_role' then
    v_handled_by := p_handled_by;
  elsif exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    v_handled_by := auth.uid(); -- nunca se confía en el p_handled_by que mande el cliente
  else
    raise exception 'Solo un administrador o el backend (service role) puede administrar solicitudes de canje';
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
  if p_new_status = 'delivered' and v_req.status <> 'approved' then
    raise exception 'Solo se puede marcar entregada una solicitud ya aprobada (approved) — aprueba primero la solicitud %', p_request_id;
  end if;

  if p_new_status = 'delivered' then
    update public.wallet_balances
      set balance  = balance - v_req.amount,
          reserved = reserved - v_req.amount,
          updated_at = now()
      where profile_id = v_req.user_id and currency_code = v_req.currency_code;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected <> 1 then
      raise exception 'No se pudo debitar la wallet de % (%) para la solicitud % — filas afectadas: % (se aborta y no se cambia el estado)',
        v_req.currency_code, v_req.user_id, p_request_id, v_rows_affected;
    end if;

    insert into public.wallet_transactions
      (profile_id, currency_code, type, amount, source, description, metadata, created_by)
    values
      (v_req.user_id, v_req.currency_code, 'redeem', -v_req.amount, 'redemption',
       coalesce(v_req.requested_item, 'Canje de recompensa'),
       jsonb_build_object('redemption_request_id', v_req.id),
       v_handled_by)
    returning * into v_tx;

    update public.redemption_requests
      set status = 'delivered', delivered_at = now(), handled_by = v_handled_by,
          admin_notes = coalesce(p_admin_notes, admin_notes),
          user_message = coalesce(p_user_message, user_message)
      where id = p_request_id
      returning * into v_req;

  elsif p_new_status in ('rejected','cancelled') then
    update public.wallet_balances
      set reserved = reserved - v_req.amount, updated_at = now()
      where profile_id = v_req.user_id and currency_code = v_req.currency_code;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected <> 1 then
      raise exception 'No se pudo liberar el reservado de % (%) para la solicitud % — filas afectadas: % (se aborta y no se cambia el estado)',
        v_req.currency_code, v_req.user_id, p_request_id, v_rows_affected;
    end if;

    update public.redemption_requests
      set status = p_new_status,
          rejected_at  = case when p_new_status = 'rejected'  then now() else rejected_at  end,
          cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end,
          handled_by = v_handled_by,
          admin_notes = coalesce(p_admin_notes, admin_notes),
          user_message = coalesce(p_user_message, user_message)
      where id = p_request_id
      returning * into v_req;

  else -- approved
    update public.redemption_requests
      set status = 'approved', approved_at = now(), handled_by = v_handled_by,
          admin_notes = coalesce(p_admin_notes, admin_notes),
          user_message = coalesce(p_user_message, user_message)
      where id = p_request_id
      returning * into v_req;
  end if;

  return v_req;
end;
$$;

comment on function public.admin_update_redemption_status is 'Único camino administrativo. Flujo: pending -> approved -> delivered (delivered ya NO admite un salto directo desde pending); rejected desde pending o approved; cancelled desde pending o approved. Cada UPDATE de wallet_balances se verifica con GET DIAGNOSTICS ROW_COUNT = 1, si no se aborta toda la operación. Callable con la Service Role Key O por un usuario autenticado con profiles.role=admin (el propio auth.uid()). handled_by SIEMPRE es auth.uid() cuando llama un admin autenticado — el parámetro p_handled_by solo se respeta viniendo de service_role.';

-- Grants explícitos y completos (no se depende del ACL de la versión
-- anterior de esta función):
revoke execute on function public.admin_update_redemption_status from public;
grant  execute on function public.admin_update_redemption_status to authenticated;
grant  execute on function public.admin_update_redemption_status to service_role;
