// BLIP, live. Signs in as BLIP and sits in the fREgs live pond like a player with the game open:
// follows his daily routine, says GM to frogs that hop in, answers ribbits, hearts and notes,
// and now and then challenges a frog that isn't busy to Croak Off (the server makes his picks).
//
// Needs supabase/blip.sql. Settings come from environment variables (see README.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, BLIP_EMAIL, BLIP_PASSWORD
//   optional: CHALLENGE_EVERY_MIN (default 5), DRY_RUN=1 (log what he'd do, send nothing)
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';

// ---- shared with the game (js/app.js) ----------------------------------------------------------
export const NOTES = ['GM', 'RIBBIT!', 'NICE FIT', 'CUTE FROG', 'HOP ON!', 'WAGMI', 'CROAK CROAK', '<3'];
const SLOTS = ['eyes', 'head', 'drip'];
// his day in Pacific time, [from minute of the day, what he's doing]; the game and blip.sql use the same hours
const BLIP_DAY = [[0, 'sleep'], [390, 'home'], [420, 'social'], [540, 'catch'], [600, 'social'], [720, 'mart'], [780, 'croak'], [840, 'closet'],
  [900, 'social'], [960, 'hop'], [1020, 'social'], [1200, 'croak'], [1260, 'catch'], [1290, 'social'], [1365, 'sleep']];
const hashOf = s => { let h = 0; for (const ch of String(s)) h = (h*31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
export function blipNow(t = Date.now()){
  const parts = fmt.formatToParts(new Date(t)), get = k => +(parts.find(x => x.type === k) || {}).value || 0;
  const min = (get('hour') % 24)*60 + get('minute');
  let act = 'sleep'; for (const [from, a] of BLIP_DAY) if (min >= from) act = a;
  const slot = Math.floor(t/600000);   // a new spot on the water every 10 minutes
  return { act, sleep: act === 'sleep', x: Math.round((.12 + (hashOf('blip' + slot) % 1000)/1000*.76)*1000)/1000 };
}
const fkOf = (equipped, sleeping) => SLOTS.map(s => (equipped && equipped[s]) || '').join('|') + '|' + (sleeping ? 1 : 0);

// ---- BLIP ----------------------------------------------------------------------------------------
const BUSY = new Set(['catch', 'hop', 'stack', 'croak', 'sleep']);   // don't challenge frogs in a game or asleep
const ANSWER = { 'GM': 'GM', 'NICE FIT': '<3', 'CUTE FROG': '<3', 'WAGMI': 'WAGMI', 'CROAK CROAK': 'CROAK CROAK', 'HOP ON!': 'HOP ON!' };
const pick = a => a[Math.floor(Math.random()*a.length)];
const day = () => new Date().toISOString().slice(0, 10);

export function startBlip(sb, opt = {}){
  const o = { challengeEveryMin: 5, tickMs: 20000, dry: false, log: (...a) => console.log(new Date().toISOString(), ...a), ...opt };
  const log = o.log;
  let id = null, equipped = null, ch = null, joined = false, stopped = false, sent = '', tick = 0, retry = 0;
  let peers = new Map();                 // frog id -> {act, x}
  const greeted = new Map();             // frog id -> when BLIP last said GM to it
  const cool = new Map();                // frog id -> when BLIP last answered it
  let challenged = { day: day(), ids: new Set() }, lastChallenge = 0, lastSay = 0;

  const state = () => { const b = blipNow(); return { uid: id, x: b.x, act: b.sleep ? 'sleep' : b.act, fk: fkOf(equipped, b.sleep) }; };
  async function send(event, payload){
    if (o.dry){ log('[dry]', event, JSON.stringify(payload)); return; }
    if (ch && joined) await ch.send({ type: 'broadcast', event, payload });
  }
  // one note at a time, a couple of seconds apart, so a busy pond doesn't get spammed
  function say(note, delay = 0){
    const i = NOTES.indexOf(note); if (i < 0) return;
    const at = Math.max(Date.now() + delay, lastSay + 2600); lastSay = at;
    if (at - Date.now() > 12000) return;   // too much queued: skip this one
    setTimeout(() => { if (!stopped) send('say', { from: id, i }); }, at - Date.now());
  }
  const answerable = (from, ms) => { const t = cool.get(from) || 0; if (Date.now() - t < ms) return false; cool.set(from, Date.now()); return true; };

  function onSync(){
    const ps = ch.presenceState(), next = new Map();
    for (const k in ps){ const p = ps[k][0]; if (p && p.uid && String(p.uid) !== id) next.set(String(p.uid), { act: p.act, x: p.x }); }
    const awake = !blipNow().sleep;
    for (const [fid] of next){
      if (peers.has(fid)) continue;
      // someone hopped in: GM, unless he said it to them in the last 6 hours
      if (awake && Date.now() - (greeted.get(fid) || 0) > 6*3600e3){ greeted.set(fid, Date.now()); say('GM', 2000 + Math.random()*3000); log('hi', fid); }
    }
    peers = next;
  }
  function onEmote(e){
    if (!e || e.to !== id || !e.from || e.from === id || blipNow().sleep) return;
    if (!answerable(e.from, 8000)) return;
    const kind = e.kind === 'heart' ? 'heart' : 'ribbit';
    setTimeout(() => send('emote', { from: id, to: e.from, kind }), 900);
    say(kind === 'heart' ? '<3' : 'RIBBIT!', 1500);
  }
  function onSay(s){
    if (!s || !s.from || s.from === id || !NOTES[s.i] || blipNow().sleep) return;
    const back = ANSWER[NOTES[s.i]];
    if (!back && Math.random() > .3) return;
    if (!answerable(s.from, 60000)) return;
    say(back || 'RIBBIT!', 1400);
  }

  async function maybeChallenge(){
    const b = blipNow(); if (b.sleep) return;
    if (challenged.day !== day()) challenged = { day: day(), ids: new Set() };
    // more often when he's "up for Croak Off" on his routine
    const every = (b.act === 'croak' ? o.challengeEveryMin/2 : o.challengeEveryMin)*60e3;
    if (Date.now() - lastChallenge < every) return;
    const free = [...peers].filter(([fid, p]) => !BUSY.has(p.act) && !challenged.ids.has(fid) && !fid.startsWith('guest-')).map(([fid]) => fid);
    if (!free.length) return;
    lastChallenge = Date.now();
    const to = pick(free), wager = pick([10, 25]);
    challenged.ids.add(to);
    if (o.dry){ log('[dry] challenge', to, wager); return; }
    const { data, error } = await sb.rpc('croak_challenge', { p_target: to, p_wager: wager });
    if (error){ log('challenge skipped:', to, error.message); return; }
    await send('challenge', { from: id, to, match: data.id, wager });
    log('challenged', to, 'for', wager);
  }

  function join(){
    if (stopped) return;
    joined = false;
    ch = sb.channel('pond', { config: { presence: { key: id }, broadcast: { self: false } } });
    ch.on('presence', { event: 'sync' }, onSync);
    ch.on('broadcast', { event: 'emote' }, ({ payload }) => onEmote(payload));
    ch.on('broadcast', { event: 'say' }, ({ payload }) => onSay(payload));
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED'){
        joined = true; retry = 0; sent = '';
        log('in the pond');
        await update();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
        if (!joined && status === 'CLOSED') return;
        joined = false;
        const wait = Math.min(60000, 2000*2**retry++);
        log('pond connection', status, '- trying again in', wait/1000, 's');
        const old = ch; ch = null;
        setTimeout(() => { sb.removeChannel(old).catch(() => {}); join(); }, wait);
      }
    });
  }
  async function update(){
    if (!ch || !joined) return;
    const st = state(), js = JSON.stringify(st);
    if (js === sent) return;
    sent = js;
    if (o.dry) log('[dry] track', js); else await ch.track(st);
    log('now', st.act, 'at', st.x);
  }

  async function start(){
    const { data: meRow, error } = await sb.rpc('get_me');
    if (error || !meRow || !meRow.id) throw new Error('get_me failed: ' + (error ? error.message : 'no frog for this sign-in'));
    id = String(meRow.id);
    const { data: info } = await sb.rpc('npc_info');
    if (!info || String(info.id) !== id) throw new Error('This sign-in is not BLIP. Run blip.sql with this email in blip_setup().');
    const { data: rows } = await sb.from('public_frogs').select('*').eq('id', id).limit(1);
    equipped = (rows && rows[0] && rows[0].equipped) || meRow.equipped || null;
    log(`signed in as ${meRow.name || 'BLIP'} (${id})`);
    join();
    tick = setInterval(() => { update().catch(e => log('update failed', e.message)); maybeChallenge().catch(e => log('challenge failed', e.message)); }, o.tickMs);
  }
  async function stop(){
    stopped = true; clearInterval(tick);
    if (ch){ try { await ch.untrack(); } catch (e) {} await sb.removeChannel(ch).catch(() => {}); }
    log('left the pond');
  }
  return { start, stop, _debug: () => ({ id, peers, greeted, challenged, joined }) };
}

// ---- run it -------------------------------------------------------------------------------------
async function main(){
  const env = process.env, need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'BLIP_EMAIL', 'BLIP_PASSWORD'].filter(k => !env[k]);
  if (need.length){ console.error('Missing settings:', need.join(', '), '(see README.md)'); process.exit(1); }
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true },
    realtime: { transport: WebSocket },
  });
  const { error } = await sb.auth.signInWithPassword({ email: env.BLIP_EMAIL, password: env.BLIP_PASSWORD });
  if (error){ console.error('Could not sign in as BLIP:', error.message); process.exit(1); }
  const blip = startBlip(sb, { challengeEveryMin: +env.CHALLENGE_EVERY_MIN || 5, dry: env.DRY_RUN === '1' });
  await blip.start();
  const bye = async () => { await blip.stop(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message || e); process.exit(1); });
