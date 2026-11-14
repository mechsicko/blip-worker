# blip-worker

Runs BLIP live in the fREgs pond. Without it, the game still shows BLIP on his daily routine and he still
plays Croak Off and visits frogs (that part lives in Supabase). With it running, BLIP is a real presence in
the pond: everyone sees the same BLIP, he says GM to frogs that hop in, answers ribbits, hearts and notes,
and challenges frogs that aren't busy to Croak Off (10 or 25 points, once per frog a day).

It holds one realtime connection (the free Supabase plan allows 200).

## Before you start

1. Run `supabase/blip.sql` (it needs BLIP's sign-in made first; see the top of that file).
2. You need BLIP's email and password, your Supabase project URL and the anon / publishable key
   (the same two values that are in `fregs/config.js`). Never use the service_role key here.

## Run it on any computer that stays on

Node 20 or newer:

```
cd blip-worker
npm install
SUPABASE_URL=... SUPABASE_ANON_KEY=... BLIP_EMAIL=... BLIP_PASSWORD=... npm start
```

Add `DRY_RUN=1` to watch what he would do without sending anything.

## Or host it (a few dollars a month)

It's a background worker with no web page, so pick a host that keeps it running.

- **Railway:** New Project, Deploy from GitHub repo (put this folder in a repo), set the four variables under
  Variables. Railway uses the Dockerfile.
- **Fly.io:** in this folder run `fly launch --no-deploy` (say no to a database and to an HTTP service), then
  `fly secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... BLIP_EMAIL=... BLIP_PASSWORD=...` and `fly deploy`.
  Keep one machine running (`fly scale count 1`) and turn off auto-stop.

Don't run two copies at once, or BLIP shows up twice.

## Tuning

- `CHALLENGE_EVERY_MIN` (default 5): how often he looks for someone to challenge. During his Croak Off
  hours on the routine (1 to 2 PM and 8 to 9 PM Pacific) he looks twice as often.
- The server limits still apply: 3 BLIP games a frog a day, 10 or 25 points, one challenge per frog a day.
  Change those in `croak_rules()` in `croak-off.sql`.
- His routine (when he sleeps, plays, shops) is `BLIP_DAY` in `blip.js`. The same list is in the game
  (`js/app.js`) and the sleep hours are in `blip_asleep()` in `blip.sql`; change all three together.
