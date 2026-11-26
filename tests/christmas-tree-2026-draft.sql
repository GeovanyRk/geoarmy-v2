-- GEO ARMY | Árbol Navidad 2026 | BORRADOR NO APLICADO.
-- Revisar en una BD de pruebas antes de activar. No modifica tablas ni motores existentes.
begin;
create schema christmas_2026;
revoke all on schema christmas_2026 from public,anon,authenticated;
create table christmas_2026.tree_config (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  start_day date not null default '2026-12-01',
  end_day date not null default '2026-12-24',
  xp_user_cap int not null default 400 check(xp_user_cap between 0 and 400),
  xp_global_cap int not null default 23200 check(xp_global_cap between 0 and 23200),
  gcoin_user_cap int not null default 250 check(gcoin_user_cap between 0 and 250),
  gcoin_global_cap int not null default 6000 check(gcoin_global_cap between 0 and 6000),
  vb_global_cap int not null default 3000 check(vb_global_cap between 0 and 3000),
  check(start_day='2026-12-01'::date and end_day='2026-12-24'::date)
);
insert into christmas_2026.tree_config default values;
create table christmas_2026.tree_claims (
  profile_id uuid not null references public.profiles(id),
  twitch_id text not null,
  claim_day date not null,
  gift smallint not null check(gift between 1 and 24 and gift=extract(day from claim_day)),
  reward text not null check(reward in ('XP','GCOIN','VBUCKS','SOUVENIR')),
  amount int not null,
  idempotency_key text not null unique,
  claimed_at timestamptz not null default clock_timestamp(),
  primary key(profile_id,claim_day),
  unique(twitch_id,claim_day),
  check((reward='XP' and amount in (10,25,50,100,200)) or
        (reward='GCOIN' and amount in (10,25,100)) or
        (reward='VBUCKS' and amount in (100,500,1000)) or
        (reward='SOUVENIR' and amount=0))
);
alter table christmas_2026.tree_config enable row level security;
alter table christmas_2026.tree_claims enable row level security;
revoke all on all tables in schema christmas_2026 from public,anon,authenticated,service_role;
-- Solo el backend confiable llama la función. El perfil procede de un JWT verificado,
-- nunca del cuerpo de la solicitud. p_gift es una selección visual, no el premio.
create function christmas_2026.claim_tree(p_profile uuid,p_gift int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c christmas_2026.tree_config%rowtype;
  prior christmas_2026.tree_claims%rowtype;
  d date;
  twitch text;
  rx text; n int; w int; eligible boolean;
  ux bigint; ug bigint; uv bigint; gx bigint; gg bigint; gv bigint;
  stock100 bigint; stock500 bigint; stock1000 bigint;
  k text; applied boolean; result jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_profile is null or p_gift is null or p_gift not between 1 and 24 then raise exception 'invalid_request'; end if;
  -- Serializa todas las aperturas: inventario, topes y créditos quedan en la misma transacción.
  select * into c from christmas_2026.tree_config where id for update;
  if not found or not c.enabled then return jsonb_build_object('status','disabled'); end if;
  d := (clock_timestamp() at time zone 'America/New_York')::date;
  if d not between c.start_day and c.end_day then return jsonb_build_object('status','outside_window'); end if;
  if p_gift <> extract(day from d)::int then return jsonb_build_object('status','gift_not_available'); end if;
  select p.twitch_id into twitch from public.profiles p where p.id=p_profile;
  if not found or twitch is null or btrim(twitch)='' then return jsonb_build_object('status','profile_required'); end if;
  select * into prior from christmas_2026.tree_claims where twitch_id=twitch and claim_day=d;
  if found then
    if prior.profile_id<>p_profile then return jsonb_build_object('status','already_claimed'); end if;
    return jsonb_build_object('status','already_claimed','day',d,'gift',prior.gift,'reward',prior.reward,'amount',prior.amount);
  end if;
  select coalesce(sum(amount) filter(where reward='XP' and twitch_id=twitch),0),
         coalesce(sum(amount) filter(where reward='GCOIN' and twitch_id=twitch),0),
         count(*) filter(where reward='VBUCKS' and twitch_id=twitch),
         coalesce(sum(amount) filter(where reward='XP'),0),
         coalesce(sum(amount) filter(where reward='GCOIN'),0),
         coalesce(sum(amount) filter(where reward='VBUCKS'),0),
         count(*) filter(where reward='VBUCKS' and amount=100),
         count(*) filter(where reward='VBUCKS' and amount=500),
         count(*) filter(where reward='VBUCKS' and amount=1000)
    into ux,ug,uv,gx,gg,gv,stock100,stock500,stock1000 from christmas_2026.tree_claims;
  -- Sorteo base de 10.000 puntos de probabilidad.
  w := floor(random()*10000)::int;
  select v.reward,v.amount into rx,n from (values
    ('XP',10,3500),('XP',25,5000),('XP',50,5700),('XP',100,5950),('XP',200,6000),
    ('GCOIN',10,8500),('GCOIN',25,9500),('GCOIN',100,9700),
    ('VBUCKS',100,9900),('VBUCKS',500,9980),('VBUCKS',1000,10000)
  ) v(reward,amount,upper_bound) where w<v.upper_bound order by v.upper_bound limit 1;
  eligible := case rx
    when 'XP' then ux+n<=c.xp_user_cap and gx+n<=c.xp_global_cap
    when 'GCOIN' then ug+n<=c.gcoin_user_cap and gg+n<=c.gcoin_global_cap
    when 'VBUCKS' then uv=0 and gv+n<=c.vb_global_cap and
      case n when 100 then stock100<10 when 500 then stock500<2 when 1000 then stock1000<1 else false end
    else false end;
  -- El agotamiento nunca aumenta la probabilidad de V-Bucks ni permite sobrepasar topes.
  -- Alternativa: 10 XP, luego 10 G-Coins, o recuerdo simbólico sin saldo.
  if not eligible then
    if ux+10<=c.xp_user_cap and gx+10<=c.xp_global_cap then rx:='XP';n:=10;
    elsif ug+10<=c.gcoin_user_cap and gg+10<=c.gcoin_global_cap then rx:='GCOIN';n:=10;
    else rx:='SOUVENIR';n:=0; end if;
  end if;
  k:='christmas_tree_2026:'||p_profile::text||':'||d::text;
  insert into christmas_2026.tree_claims(profile_id,twitch_id,claim_day,gift,reward,amount,idempotency_key)
    values(p_profile,twitch,d,p_gift,rx,n,k);
  if rx='XP' then
    -- El CHECK actual de xp_transactions no admite un source nuevo.
    -- admin_grant es el tipo técnico permitido; el motivo y la clave identifican Navidad.
    select a.applied into applied from public._apply_xp_change(p_profile,n,'admin_grant',k,null,'Árbol de Navidad 2026',null) a;
    if applied is distinct from true then raise exception 'xp_not_applied'; end if;
  elsif rx in ('GCOIN','VBUCKS') then
    perform public.wallet_apply_transaction(p_profile,rx,n,'earn','christmas_tree_2026',
      'Árbol de Navidad 2026',jsonb_build_object('claim_day',d,'gift',p_gift),null,k);
  end if;
  return jsonb_build_object('status','granted','day',d,'gift',p_gift,'reward',rx,'amount',n);
end;
$$;
revoke all on function christmas_2026.claim_tree(uuid,int) from public,anon,authenticated;
grant usage on schema christmas_2026 to service_role;
grant execute on function christmas_2026.claim_tree(uuid,int) to service_role;
create function public.christmas_tree_claim_v1(p_profile uuid,p_gift int)
returns jsonb language sql security invoker set search_path='' as $$
  select christmas_2026.claim_tree(p_profile,p_gift);
$$;
revoke all on function public.christmas_tree_claim_v1(uuid,int) from public,anon,authenticated;
grant execute on function public.christmas_tree_claim_v1(uuid,int) to service_role;
commit;
-- Activación deliberadamente omitida. No cambiar enabled sin auditoría, pruebas y aprobación.
