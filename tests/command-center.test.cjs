'use strict';
// Pruebas del núcleo del Geo Army Command Center (sin DOM, sin red real).
//   node --test tests/command-center.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const CC = require('../js/command-center-core.js');
const Demo = require('../js/command-center-demo.js');

const BASE = CC.API_BASE;
function makeClient(srv, token) {
  return CC.createApiClient({ fetch: srv.fetch, getToken: async () => (token === undefined ? 'TKN' : token) });
}

test('contrato: base URL exacta y sin alias !overwatch en las fixtures', async () => {
  assert.equal(BASE, 'https://geoarmy.duckdns.org/api/bot-admin/v1');
  const srv = Demo.create({ latencyMs: 0 });
  const list = await makeClient(srv).commands();
  assert.equal(list.length, 11);
  assert.ok(!JSON.stringify(list).toLowerCase().includes('overwatch'));
  assert.deepEqual(list.find(c => c.name === 'pavos').aliases, ['vbucks']);
});

test('cliente: Authorization Bearer, sin token ⇒ 401 local y ninguna solicitud', async () => {
  let seen = null, calls = 0;
  const c = CC.createApiClient({ fetch: async (u, i) => { calls++; seen = i; return new Response('{"channel":"x"}', { status: 200 }); }, getToken: async () => 'abc' });
  await c.status();
  assert.equal(seen.headers.Authorization, 'Bearer abc');
  assert.equal(seen.credentials, 'omit');
  const none = CC.createApiClient({ fetch: async () => { calls++; return new Response('{}'); }, getToken: async () => null });
  await assert.rejects(() => none.status(), e => e.kind === 'http' && e.status === 401);
  assert.equal(calls, 1);
});

test('cliente: PATCH envía If-Match con comillas + Content-Type, y solo el parche', async () => {
  let init = null;
  const c = CC.createApiClient({
    fetch: async (u, i) => { init = i; return new Response(JSON.stringify({ mode: 'TEST', cooldowns: { userSeconds: 20 }, commands: { pavos: false }, allowOffline: true }), { status: 200, headers: { ETag: '"v9"' } }); },
    getToken: async () => 't'
  });
  const r = await c.patchConfig({ commands: { pavos: false } }, '"v8"');
  assert.equal(init.method, 'PATCH');
  assert.equal(init.headers['If-Match'], '"v8"');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, '{"commands":{"pavos":false}}');
  assert.equal(r.etag, '"v9"');
  assert.equal(r.status, 200);
});

test('cliente: red caída ≠ error HTTP; abort se distingue', async () => {
  const down = CC.createApiClient({ fetch: async () => { throw new TypeError('Failed to fetch'); }, getToken: async () => 't' });
  await assert.rejects(() => down.status(), e => e.kind === 'network');
  const ac = new AbortController(); ac.abort();
  const ab = CC.createApiClient({ fetch: async (u, i) => { const e = new Error('x'); e.name = 'AbortError'; throw e; }, getToken: async () => 't' });
  await assert.rejects(() => ab.status(ac.signal), e => e.kind === 'aborted');
  const d = CC.describeError(CC.ApiError('network'));
  assert.match(d.title, /inaccesible/i);
});

test('errores HTTP: todos los códigos del contrato tienen mensaje y conservan el código de la API', async () => {
  for (const s of [400, 401, 403, 404, 412, 413, 415, 428, 500, 503]) {
    const c = CC.createApiClient({ fetch: async () => new Response(JSON.stringify({ error: 'codigo_' + s }), { status: s }), getToken: async () => 't' });
    await assert.rejects(() => c.config(), e => {
      const d = CC.describeError(e);
      return e.status === s && e.code === 'codigo_' + s && d.title && !/Error HTTP/.test(d.title);
    });
  }
});

test('servidor DEMO: If-Match ausente ⇒ 428, desfasado ⇒ 412, válido ⇒ 200 y ETag nuevo', async () => {
  const srv = Demo.create({ latencyMs: 0 });
  const c = makeClient(srv);
  const { config, etag } = await c.config();
  assert.match(etag, /^".+"$/);
  await assert.rejects(() => c.patchConfig({ allowOffline: false }, null), e => e.status === 428);
  await assert.rejects(() => c.patchConfig({ allowOffline: false }, '"otra"'), e => e.status === 412 && e.code === 'stale_config');
  const ok = await c.patchConfig({ allowOffline: false }, etag);
  assert.equal(ok.status, 200);
  assert.notEqual(ok.etag, etag);
  assert.equal(ok.config.allowOffline, false);
  assert.equal(config.allowOffline, true);                      // la copia confirmada previa no se mutó
  await assert.rejects(() => c.patchConfig({ ownerUserId: '1' }, ok.etag), e => e.status === 400);      // solo lectura
  await assert.rejects(() => c.patchConfig({ cooldowns: { userSeconds: 4 } }, ok.etag), e => e.status === 400); // fuera de límites
  const audit = await c.audit(5);
  assert.deepEqual(audit[0].changed, { allowOffline: false });   // valores nuevos, orden descendente
});

test('diffConfig: solo lo modificado; sin cambios ⇒ {}', async () => {
  const { config } = await makeClient(Demo.create({ latencyMs: 0 })).config();
  assert.deepEqual(CC.diffConfig(config, CC.editableOf(config)), {});
  const d = CC.editableOf(config); d.commands.pavos = false; d.cooldowns.userSeconds = 20;
  assert.deepEqual(CC.diffConfig(config, d), { cooldowns: { userSeconds: 20 }, commands: { pavos: false } });
  assert.equal(CC.countChanges(CC.diffConfig(config, d)), 2);
  d.commands.pavos = true; d.cooldowns.userSeconds = 15;
  assert.deepEqual(CC.diffConfig(config, d), {});               // volver al valor confirmado retira el pendiente
});

test('validateDraft usa los límites reales de la API', async () => {
  const { config } = await makeClient(Demo.create({ latencyMs: 0 })).config();
  const d = CC.editableOf(config);
  d.cooldowns.userSeconds = 4; d.cooldowns.commandSeconds = 121;
  const e = CC.validateDraft(config, d);
  assert.ok(e.userSeconds && e.commandSeconds);
  d.cooldowns.userSeconds = 5; d.cooldowns.commandSeconds = 120;
  assert.deepEqual(CC.validateDraft(config, d), {});
  d.cooldowns.userSeconds = NaN;
  assert.ok(CC.validateDraft(config, d).userSeconds);
  d.cooldowns.userSeconds = 10.5;
  assert.ok(CC.validateDraft(config, d).userSeconds);
});

test('rebaseDraft (412): no pierde cambios, marca conflictos y no aplica nada por su cuenta', async () => {
  const { config: old } = await makeClient(Demo.create({ latencyMs: 0 })).config();
  const mine = CC.editableOf(old); mine.cooldowns.userSeconds = 25; mine.commands.top = false; mine.allowOffline = false;
  const fresh = JSON.parse(JSON.stringify(old)); fresh.cooldowns.userSeconds = 60; fresh.allowOffline = false; fresh.cooldowns.commandSeconds = 9;
  const rb = CC.rebaseDraft(old, fresh, mine);
  assert.deepEqual(rb.conflicts.map(c => c.path), ['cooldowns.userSeconds']);
  assert.equal(rb.conflicts[0].theirs, 60); assert.equal(rb.conflicts[0].mine, 25);
  assert.deepEqual(rb.dropped.map(c => c.path), ['allowOffline']);       // el servidor ya lo tiene
  assert.deepEqual(rb.serverChanges.map(c => c.path), ['cooldowns.commandSeconds']);
  assert.deepEqual(CC.diffConfig(fresh, rb.draft), { cooldowns: { userSeconds: 25 }, commands: { top: false } });
  assert.equal(fresh.cooldowns.userSeconds, 60);                          // el servidor no se tocó
});

test('descripciones legibles de cambios y auditoría', () => {
  assert.deepEqual(CC.describeAudit({ allowOffline: false, cooldowns: { userSeconds: 20 }, commands: { pavos: false } }), [
    'Comandos bloqueados mientras el canal está offline', 'Cooldown por usuario: 20 s', 'Comando !pavos deshabilitado']);
  assert.match(CC.describeChange('mode', 'PUBLIC'), /PUBLIC/);
  assert.match(CC.describeChange('campoNuevo', 5), /campoNuevo: 5/);       // campos desconocidos: texto plano, sin inventar
});

test('normAudit ordena del más reciente al más antiguo y tolera datos raros', () => {
  const out = CC.normAudit({ entries: [{ at: '2026-11-27T10:00:00Z', actorTwitchId: 1, changed: {} }, { at: '2026-11-27T12:00:00Z', actorTwitchId: '2', changed: { mode: 'TEST' } }, { nope: 1 }] });
  assert.deepEqual(out.map(e => e.at), ['2026-11-27T12:00:00Z', '2026-11-27T10:00:00Z']);
  assert.equal(out[1].actorTwitchId, '1');
});

test('normStatus: stream solo live/offline/unknown; sin inventar sockets IRC', () => {
  const s = CC.normStatus({ channel: 'c', mode: 'TEST', uptimeSeconds: 1, discordConnected: true, irc: { connected: true, uptimeSeconds: 1, sockets: 9 }, stream: { state: 'raro', checkedAt: 'x' } });
  assert.equal(s.stream.state, 'unknown');
  assert.ok(!('sockets' in s.irc));
});

test('disponibilidad efectiva según modo, IRC, canal y estado individual', () => {
  const st = (o) => Object.assign({ irc: { connected: true }, stream: { state: 'live' } }, o);
  const cfg = (o) => Object.assign({ mode: 'PUBLIC', allowOffline: true }, o);
  const A = (cmd, s, c) => CC.commandAvailability(cmd, { status: s, config: c }).state;
  assert.equal(A({ enabled: true }, st(), cfg()), 'on');
  assert.equal(A({ enabled: true }, st(), cfg({ mode: 'TEST' })), 'limited');
  assert.equal(A({ enabled: true }, st(), cfg({ mode: 'OFF' })), 'blocked');
  assert.equal(A({ enabled: false }, st(), cfg()), 'off');
  assert.equal(A({ enabled: true }, st({ irc: { connected: false } }), cfg()), 'blocked');
  assert.equal(A({ enabled: true }, st({ stream: { state: 'offline' } }), cfg({ allowOffline: false })), 'blocked');
  assert.equal(A({ enabled: true }, st({ stream: { state: 'offline' } }), cfg({ allowOffline: true })), 'on');
  assert.equal(A({ enabled: true }, st({ stream: { state: 'unknown' } }), cfg({ allowOffline: false })), 'unknown');
  assert.equal(A({ enabled: true }, null, cfg()), 'unknown');
});

test('sondeo: sin solapamientos, pausa oculto y reanuda', async () => {
  let t = 0, timers = [], running = 0, maxRun = 0, runs = 0, release = null;
  const poller = CC.createPoller({
    intervalMs: 30000, now: () => t,
    setTimeout: (fn, ms) => { const id = timers.push({ fn, at: t + ms }); return id; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].dead = true; },
    task: () => new Promise(res => { running++; maxRun = Math.max(maxRun, running); runs++; release = () => { running--; res(); }; })
  });
  const fire = async () => { const d = timers.filter(x => !x.dead && !x.done).sort((a, b) => a.at - b.at)[0]; if (d) { d.done = true; t = d.at; d.fn(); await Promise.resolve(); } };
  poller.start(false);
  await fire(); assert.equal(runs, 1);
  poller.setVisible(false); poller.setVisible(true);               // reentrada con la tarea en curso: no duplica
  assert.equal(runs, 1);
  release(); await new Promise(r => setImmediate(r));
  await fire(); assert.equal(runs, 2);
  release(); await new Promise(r => setImmediate(r));
  poller.setVisible(false);
  assert.equal(timers.filter(x => !x.dead && !x.done).length, 0);   // oculto ⇒ sin timers
  t += 100000; poller.setVisible(true);
  await fire(); assert.equal(runs, 3);                               // al volver, refresca (venció el intervalo)
  assert.equal(maxRun, 1);
  poller.stop();
});

test('formatters', () => {
  assert.equal(CC.formatDuration(864), '14 m 24 s');
  assert.equal(CC.formatDuration(3900), '1 h 05 m');
  assert.equal(CC.formatDuration(90000), '1 d 1 h 00 m');
  assert.equal(CC.formatDuration(null), '—');
  assert.equal(CC.relativeTime('2026-11-27T22:00:00Z', Date.parse('2026-11-27T22:05:00Z')), 'hace 5 min');
  assert.equal(CC.clampInt('500', 1, 100, 20), 100);
});
