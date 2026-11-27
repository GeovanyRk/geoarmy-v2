-- GEO ARMY Awards 2026. Isolated schema; disabled until launch approval.
create schema geo_awards_2026;
revoke all on schema geo_awards_2026 from public,anon,authenticated;
create table geo_awards_2026.settings(
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 opens_at timestamptz not null default '2026-12-01 00:00:00-05',
 noms_end timestamptz not null default '2026-12-08 00:00:00-05',
 closes_at timestamptz not null default '2027-01-01 00:00:00-05',
 gala_at timestamptz not null default '2027-01-01 19:00:00-05',
 community_weight numeric not null default 60 check(community_weight>=0),
 web_weight numeric not null default 25 check(web_weight>=0),
 jury_weight numeric not null default 15 check(jury_weight>=0),
 owner_twitch_id text not null, check(community_weight+web_weight+jury_weight=100),
 check(opens_at<noms_end and noms_end<closes_at and closes_at<=gala_at)
);
insert into geo_awards_2026.settings(owner_twitch_id) select twitch_id from public.profiles where lower(twitch_login)='geovannyrk' and role='admin';
create table geo_awards_2026.categories(code text primary key,label text not null,kind text not null check(kind in ('fixed','nominated','web','external')),description text not null,icon text not null,sort int not null unique);
insert into geo_awards_2026.categories values
 ('current','Moderador actual del año','fixed','Mejor moderador del equipo vigente.','🛡️',1),
 ('legacy','Moderador histórico 2026','fixed','Antiguo moderador que dejó mayor huella.','👑',2),
 ('member','Miembro del año','nominated','Quien mejor representa a GEO ARMY.','🏆',3),
 ('comedian','Comediante del año','nominated','Quien más risas y momentos divertidos generó.','😂',4),
 ('companion','Mejor compañero','nominated','Quien más ayuda y apoya a otros miembros.','🤝',5),
 ('revelation','Revelación del año','nominated','Miembro que comenzó a destacar este año; la comunidad lo propone.','🌟',6),
 ('gamer','Gamer del año','nominated','Jugador que más impresionó a la comunidad.','🎮',7),
 ('character','Personaje del año','nominated','Personalidad más memorable de la comunidad.','🎭',8),
 ('chat','Rey del Chat','external','Mayor cantidad de mensajes registrados por WizeBot.','💬',9),
 ('watch','Espectador más fiel','external','Mayor tiempo activo registrado por WizeBot, en minutos.','⏳',10),
 ('gifts','Benefactor del año','external','Mayor cantidad de suscripciones regaladas verificadas.','💎',11),
 ('xp','Leyenda GEO ARMY','web','Mayor XP neta registrada en 2026.','⚔️',12),
 ('streak','El incansable','web','Mayor racha registrada en 2026.','🔥',13),
 ('missions','Maestro de misiones','web','Mayor número de transacciones de XP por misiones completadas.','🎯',14);
create table geo_awards_2026.fixed(category text references geo_awards_2026.categories,login text not null,twitch_id text,primary key(category,login),unique(login),check(login=lower(login)));
insert into geo_awards_2026.fixed(category,login,twitch_id)
select n.c,n.l,p.twitch_id from (values
('current','kittykitty_katt'),('current','kirbyx01'),('current','mufasa1912'),
('legacy','502jona'),('legacy','alexjuanforever'),('legacy','edgarca24'),('legacy','eira_eu'),('legacy','ermichael94'),('legacy','forsaken453'),('legacy','joseangelyoon_rk'),('legacy','josem55a'),('legacy','kiro_hyer'),('legacy','lisitahyuga_'),('legacy','mangoalegre'),('legacy','matidk_0'),('legacy','metrickkass'),('legacy','shadowcasreal1'),('legacy','sibubulubu'),('legacy','urielzxzz'),('legacy','warnerr8'),('legacy','zenith91111')) n(c,l)
left join public.profiles p on lower(p.twitch_login)=n.l;
create table geo_awards_2026.ballots(category text references geo_awards_2026.categories,stage text check(stage in ('nominate','vote','jury')),voter_twitch_id text,candidate text not null,updated_at timestamptz not null default clock_timestamp(),primary key(category,stage,voter_twitch_id));
create table geo_awards_2026.external_inputs(category text references geo_awards_2026.categories,login text not null,twitch_id text,value numeric not null check(value>=0),source text not null,coverage text not null,captured_at timestamptz not null,primary key(category,login));
create table geo_awards_2026.settled(category text primary key references geo_awards_2026.categories,settled_at timestamptz not null default clock_timestamp(),note text not null);
create table geo_awards_2026.winners(category text references geo_awards_2026.categories,candidate text,login text not null,display_name text not null,twitch_id text,avatar text,community_votes bigint,community_points numeric,web_points numeric,jury_points numeric,total numeric,metric numeric,source text,coverage text,awarded_at timestamptz not null default clock_timestamp(),primary key(category,candidate));
do $$ declare t text; begin foreach t in array array['settings','categories','fixed','ballots','external_inputs','settled','winners'] loop execute format('alter table geo_awards_2026.%I enable row level security',t); end loop;end $$;
revoke all on all tables in schema geo_awards_2026 from public,anon,authenticated;
-- Only public Twitch identity fields, never balances or internal profile identifiers.
create function geo_awards_2026.directory()
returns table(k text,login text,display_name text,avatar text,twitch_id text)
language sql stable set search_path='' as $$
select 't:'||p.twitch_id,lower(p.twitch_login),coalesce(nullif(p.display_name,''),p.twitch_login),case when p.avatar_url like 'https://static-cdn.jtvnw.net/%' then p.avatar_url end,p.twitch_id
from public.profiles p cross join geo_awards_2026.settings s
where p.role is distinct from 'admin' and nullif(p.twitch_id,'') is not null and nullif(p.twitch_login,'') is not null and p.created_at<s.closes_at
$$;
create function geo_awards_2026.finalists(p_category text)
returns table(k text,login text,display_name text,avatar text,twitch_id text)
language sql stable set search_path='' as $$
select 'm:'||f.login,f.login,coalesce(d.display_name,f.login),d.avatar,f.twitch_id
from geo_awards_2026.fixed f left join geo_awards_2026.directory() d on d.twitch_id=f.twitch_id where f.category=p_category
union all
select d.k,d.login,d.display_name,d.avatar,d.twitch_id from geo_awards_2026.directory() d
join (select b.candidate,rank() over(order by count(*) desc) pos from geo_awards_2026.ballots b
cross join geo_awards_2026.settings s where b.category=p_category and b.stage='nominate' and b.updated_at<s.noms_end group by b.candidate) n on n.candidate=d.k and n.pos<=5
where exists(select 1 from geo_awards_2026.categories c where c.code=p_category and c.kind='nominated')
$$;
create function geo_awards_2026.metrics()
returns table(k text,login text,display_name text,avatar text,twitch_id text,days bigint,best int,missions bigint,xp bigint,web_fraction numeric)
language sql stable set search_path='' as $$
with p as (
select d.*,pr.id from geo_awards_2026.directory() d join public.profiles pr on pr.twitch_id=d.twitch_id),
s as (select user_id,count(distinct checkin_date) days,max(streak_after) best from public.streak_checkins where checkin_date>=date '2026-01-01' and checkin_date<date '2027-01-01' group by user_id),
x as (select t.profile_id,count(*) filter(where t.source='mission' and t.amount>0) missions,greatest(0,coalesce(sum(t.amount),0))::bigint xp from public.xp_transactions t cross join geo_awards_2026.settings cfg where t.created_at>=timestamptz '2026-01-01 00:00:00-05' and t.created_at<cfg.closes_at group by t.profile_id),
m as (select p.k,p.login,p.display_name,p.avatar,p.twitch_id,coalesce(s.days,0) days,coalesce(s.best,0) best,coalesce(x.missions,0) missions,coalesce(x.xp,0) xp from p left join s on s.user_id=p.id left join x on x.profile_id=p.id)
select m.*, coalesce(.4*m.days/nullif(max(m.days) over(),0),0)+coalesce(.32*m.best/nullif(max(m.best) over(),0),0)+coalesce(.28*m.missions/nullif(max(m.missions) over(),0),0) from m
$$;
-- One result snapshot per category; ties share the award rather than an arbitrary winner.
create function geo_awards_2026.settle() returns void language plpgsql set search_path='' as $$
declare cfg geo_awards_2026.settings%rowtype; cat record; j text; begin
 select * into cfg from geo_awards_2026.settings;
 if not cfg.enabled or clock_timestamp()<cfg.gala_at then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(2026123107);
 for cat in select * from geo_awards_2026.categories c where not exists(select 1 from geo_awards_2026.settled s where s.category=c.code) order by sort loop
  if cat.kind in ('fixed','nominated') then
   select b.candidate into j from geo_awards_2026.ballots b where b.category=cat.code and b.stage='jury' and b.voter_twitch_id=cfg.owner_twitch_id;
   if j is null then continue;end if;
   if not exists(select 1 from geo_awards_2026.ballots b where b.category=cat.code and b.stage='vote') then
     insert into geo_awards_2026.settled(category,note) values(cat.code,'Sin votos comunitarios válidos');continue;
   end if;
   with v as (select candidate,count(*) n from geo_awards_2026.ballots where category=cat.code and stage='vote' and updated_at<cfg.closes_at group by candidate),
   q as (select f.*,coalesce(v.n,0) n,coalesce(cfg.community_weight*v.n/nullif(max(coalesce(v.n,0)) over(),0),0) cp,
      cfg.web_weight*coalesce(m.web_fraction,0) wp,case when f.k=j then cfg.jury_weight else 0 end jp
      from geo_awards_2026.finalists(cat.code) f left join v on v.candidate=f.k left join geo_awards_2026.metrics() m on m.twitch_id=f.twitch_id),
   scored as (select q.*,cp+wp+jp total from q), ranked as (select scored.*,dense_rank() over(order by total desc,n desc,wp desc,jp desc) r from scored)
   insert into geo_awards_2026.winners(category,candidate,login,display_name,twitch_id,avatar,community_votes,community_points,web_points,jury_points,total,source,coverage)
   select cat.code,k,login,display_name,twitch_id,avatar,n,round(cp,4),round(wp,4),jp,round(total,4),'Votación + actividad web + jurado','Registros disponibles de 2026' from ranked where r=1;
  elsif cat.kind='web' then
   with q as (select m.*,case cat.code when 'xp' then m.xp when 'streak' then m.best else m.missions end val from geo_awards_2026.metrics() m),
   r as (select q.*,dense_rank() over(order by val desc) pos from q where val>0)
   insert into geo_awards_2026.winners(category,candidate,login,display_name,twitch_id,avatar,metric,source,coverage)
   select cat.code,k,login,display_name,twitch_id,avatar,val,'Registros GEO ARMY',case when cat.code='streak' then 'Rachas disponibles desde 11 oct 2026' else 'XP y misiones disponibles desde 27 ago 2026' end from r where pos=1;
  else
   if not exists(select 1 from geo_awards_2026.external_inputs e where e.category=cat.code) then continue; end if;
   with q as (select e.*,dense_rank() over(order by value desc) pos from geo_awards_2026.external_inputs e where e.category=cat.code)
   insert into geo_awards_2026.winners(category,candidate,login,display_name,twitch_id,avatar,metric,source,coverage)
   select cat.code,'e:'||q.login,q.login,coalesce(d.display_name,q.login),q.twitch_id,d.avatar,q.value,q.source,q.coverage from q left join geo_awards_2026.directory() d on d.twitch_id=q.twitch_id where q.pos=1;
  end if;
  insert into geo_awards_2026.settled(category,note) values(cat.code,case when exists(select 1 from geo_awards_2026.winners w where w.category=cat.code) then 'Premiado' else 'Sin datos válidos' end);
 end loop;
end $$;
-- RPC dispatcher: private definer, authenticated identity and server clock only.
create function geo_awards_2026.dispatch(p_action text,p_category text,p_candidate text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg geo_awards_2026.settings%rowtype; me public.profiles%rowtype; cat geo_awards_2026.categories%rowtype; t timestamptz; admin boolean:=false; phase text; own boolean; item jsonb; l text; tid text; v numeric; src text; cov text; capture timestamptz;
begin
 select * into cfg from geo_awards_2026.settings;
 if auth.uid() is not null then select * into me from public.profiles where id=auth.uid() and nullif(twitch_id,'') is not null; end if;
 admin:=coalesce(me.role='admin' and me.twitch_id=cfg.owner_twitch_id,false);
 t:=clock_timestamp();
 phase:=case when not cfg.enabled then 'preview' when t<cfg.opens_at then 'upcoming' when t<cfg.noms_end then 'nominate' when t<cfg.closes_at then 'vote' when t<cfg.gala_at then 'closed' else 'gala' end;
 if p_action in ('status','mine') then
  if phase='gala' then perform geo_awards_2026.settle();end if;
  if p_action='mine' then
   return jsonb_build_object('badges',coalesce((select jsonb_agg(jsonb_build_object('category',w.category,'label',c.label,'icon',c.icon,'kind',c.kind,'year',2026) order by c.sort) from geo_awards_2026.winners w join geo_awards_2026.categories c on c.code=w.category where phase='gala' and w.twitch_id=me.twitch_id),'[]'::jsonb));
  end if;
  return jsonb_build_object('phase',phase,'enabled',cfg.enabled,'serverNow',t,'opensAt',cfg.opens_at,'nomsEnd',cfg.noms_end,'closesAt',cfg.closes_at,'galaAt',cfg.gala_at,'authenticated',me.id is not null,'admin',admin,
   'weights',jsonb_build_object('community',cfg.community_weight,'web',cfg.web_weight,'jury',cfg.jury_weight),
   'directory',case when me.id is not null then coalesce((select jsonb_agg(jsonb_build_object('key',d.k,'login',d.login,'name',d.display_name,'avatar',d.avatar,'self',d.twitch_id=me.twitch_id) order by d.login) from geo_awards_2026.directory() d),'[]'::jsonb) else '[]'::jsonb end,
   'categories',(select jsonb_agg(jsonb_build_object('code',c.code,'label',c.label,'kind',c.kind,'description',c.description,'icon',c.icon,
   'candidates',case when c.kind='fixed' or (c.kind='nominated' and t>=cfg.noms_end) then coalesce((select jsonb_agg(jsonb_build_object('key',f.k,'login',f.login,'name',f.display_name,'avatar',f.avatar,'self',coalesce(f.twitch_id=me.twitch_id or f.login=lower(me.twitch_login),false)) order by f.login) from geo_awards_2026.finalists(c.code) f),'[]'::jsonb) else '[]'::jsonb end,
   'choice',(select b.candidate from geo_awards_2026.ballots b where b.category=c.code and b.voter_twitch_id=me.twitch_id and b.stage=case when admin then 'jury' when c.kind='nominated' and t<cfg.noms_end then 'nominate' else 'vote' end),
   'settled',case when phase='gala' then (select z.note from geo_awards_2026.settled z where z.category=c.code) end,
   'winners',case when phase='gala' then coalesce((select jsonb_agg(jsonb_build_object('name',w.display_name,'login',w.login,'avatar',w.avatar,'votes',w.community_votes,'community',w.community_points,'web',w.web_points,'jury',w.jury_points,'total',w.total,'metric',w.metric,'source',w.source,'coverage',w.coverage)) from geo_awards_2026.winners w where w.category=c.code),'[]'::jsonb) else '[]'::jsonb end) order by c.sort) from geo_awards_2026.categories c));
 end if;
 if me.id is null then raise exception 'login_required';end if;
 if not cfg.enabled then raise exception 'awards_disabled';end if;
 perform pg_catalog.pg_advisory_xact_lock(2026123107); t:=clock_timestamp();
 select * into cat from geo_awards_2026.categories where code=p_category;
 if not found then raise exception 'unknown_category';end if;
 if p_action='external' then
  if not admin or cat.kind<>'external' or t<cfg.closes_at or exists(select 1 from geo_awards_2026.settled where category=p_category) then raise exception 'not_allowed';end if;
  src:=trim(coalesce(p_payload->>'source',''));cov:=trim(coalesce(p_payload->>'coverage',''));capture:=(p_payload->>'capturedAt')::timestamptz;
  if length(src)<3 or length(src)>500 or length(cov)<3 or length(cov)>500 or capture is null or capture<cfg.closes_at or capture>t or jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 1000 then raise exception 'invalid_evidence';end if;
  delete from geo_awards_2026.external_inputs where category=p_category;
  for item in select value from jsonb_array_elements(p_payload->'rows') loop
   l:=lower(trim(item->>'login'));v:=(item->>'value')::numeric;tid:=nullif(item->>'twitchId','');
   if l is null or l !~ '^[a-z0-9_]{1,25}$' or l in ('geovannyrk','wizebot','fossabot','sery_bot') or v is null or v<0 or v>1000000000 or v<>trunc(v) then raise exception 'invalid_metric';end if;
   if tid is not null and tid !~ '^[0-9]{1,30}$' then raise exception 'invalid_twitch_id';end if;
   if tid is null then select d.twitch_id into tid from geo_awards_2026.directory() d where d.login=l;end if;
   insert into geo_awards_2026.external_inputs values(p_category,l,tid,v,src,cov,capture);
  end loop;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='link' then
  if not admin or t<cfg.gala_at then raise exception 'not_allowed';end if;
  tid:=p_payload->>'twitchId';
  if tid is null or tid !~ '^[0-9]{1,30}$' or tid=cfg.owner_twitch_id then raise exception 'invalid_twitch_id';end if;
  update geo_awards_2026.winners set twitch_id=tid where category=p_category and login=lower(p_candidate) and twitch_id is null;
  if not found then raise exception 'not_linkable';end if;
  return jsonb_build_object('ok',true);
 end if;
 if cat.kind not in ('fixed','nominated') or p_action not in ('nominate','vote','jury') then raise exception 'invalid_action';end if;
 if p_action='jury' then
  if not admin or t<cfg.opens_at or (cat.kind='nominated' and t<cfg.noms_end) or exists(select 1 from geo_awards_2026.settled where category=p_category) then raise exception 'jury_not_open';end if;
  if p_candidate<>'abstain' and not exists(select 1 from geo_awards_2026.finalists(p_category) f where f.k=p_candidate) then raise exception 'invalid_candidate';end if;
 else
  if admin or me.role='admin' then raise exception 'jury_only';end if;
  if t<cfg.opens_at or t>=cfg.closes_at then raise exception 'voting_closed';end if;
  if p_action='nominate' then
   if cat.kind<>'nominated' or t>=cfg.noms_end then raise exception 'nominations_closed';end if;
   if not exists(select 1 from geo_awards_2026.directory() d where d.k=p_candidate and d.twitch_id<>me.twitch_id) then raise exception 'invalid_candidate';end if;
  else
   if cat.kind='nominated' and t<cfg.noms_end then raise exception 'voting_not_open';end if;
   if not exists(select 1 from geo_awards_2026.finalists(p_category) f where f.k=p_candidate and coalesce(f.twitch_id<>me.twitch_id,true) and f.login<>lower(me.twitch_login)) then raise exception 'invalid_candidate';end if;
  end if;
 end if;
 insert into geo_awards_2026.ballots(category,stage,voter_twitch_id,candidate,updated_at) values(p_category,p_action,me.twitch_id,p_candidate,t)
 on conflict(category,stage,voter_twitch_id) do update set candidate=excluded.candidate,updated_at=excluded.updated_at;
 return jsonb_build_object('ok',true);
end $$;
revoke all on all functions in schema geo_awards_2026 from public,anon,authenticated;
grant usage on schema geo_awards_2026 to anon,authenticated;
grant execute on function geo_awards_2026.dispatch(text,text,text,jsonb) to anon,authenticated;
create function public.geo_awards_2026(p_action text default 'status',p_category text default null,p_candidate text default null,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select geo_awards_2026.dispatch(p_action,p_category,p_candidate,p_payload)$$;
revoke all on function public.geo_awards_2026(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.geo_awards_2026(text,text,text,jsonb) to anon,authenticated;
