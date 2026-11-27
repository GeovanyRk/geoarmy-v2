-- Restrict all web records to event cutoff; empty categories settle without a judge vote.
create or replace function geo_awards_2026.metrics()
returns table(k text,login text,display_name text,avatar text,twitch_id text,days bigint,best int,missions bigint,xp bigint,web_fraction numeric)
language sql stable set search_path='' as $$
with p as (
select d.*,pr.id from geo_awards_2026.directory() d join public.profiles pr on pr.twitch_id=d.twitch_id),
s as (select user_id,count(distinct checkin_date) days,max(streak_after) best from public.streak_checkins cross join geo_awards_2026.settings cfg where created_at<cfg.closes_at and checkin_date>=date '2026-01-01' and checkin_date<date '2027-01-01' group by user_id),
x as (select t.profile_id,count(*) filter(where t.source='mission' and t.amount>0) missions,greatest(0,coalesce(sum(t.amount),0))::bigint xp from public.xp_transactions t cross join geo_awards_2026.settings cfg where t.created_at>=timestamptz '2026-01-01 00:00:00-05' and t.created_at<cfg.closes_at group by t.profile_id),
m as (select p.k,p.login,p.display_name,p.avatar,p.twitch_id,coalesce(s.days,0) days,coalesce(s.best,0) best,coalesce(x.missions,0) missions,coalesce(x.xp,0) xp from p left join s on s.user_id=p.id left join x on x.profile_id=p.id)
select m.*, coalesce(.4*m.days/nullif(max(m.days) over(),0),0)+coalesce(.32*m.best/nullif(max(m.best) over(),0),0)+coalesce(.28*m.missions/nullif(max(m.missions) over(),0),0) from m
$$;

create or replace function geo_awards_2026.settle() returns void language plpgsql set search_path='' as $$
declare cfg geo_awards_2026.settings%rowtype; cat record; j text; begin
 select * into cfg from geo_awards_2026.settings;
 if not cfg.enabled or clock_timestamp()<cfg.gala_at then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(2026123107);
 for cat in select * from geo_awards_2026.categories c where not exists(select 1 from geo_awards_2026.settled s where s.category=c.code) order by sort loop
  if cat.kind in ('fixed','nominated') then
   select b.candidate into j from geo_awards_2026.ballots b where b.category=cat.code and b.stage='jury' and b.voter_twitch_id=cfg.owner_twitch_id;
   if not exists(select 1 from geo_awards_2026.ballots b where b.category=cat.code and b.stage='vote' and b.updated_at<cfg.closes_at) then
     insert into geo_awards_2026.settled(category,note) values(cat.code,'Sin votos comunitarios válidos');continue;
   end if;
   if j is null then continue;end if;
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

-- GMT cron: Jan 1 2027, 19:00 ET. Disabled feature remains a no-op.
select cron.schedule('geo-awards-2026-gala','0 0 2 1 *','select geo_awards_2026.settle();');
