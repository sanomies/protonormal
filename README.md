# Band Practice

A tiny online band-practice simulator: an FPS-style room you walk around in,
proximity voice chat, and live instruments — play a MIDI keyboard through the
built-in synth, or stream any audio input (guitar through an interface).
Everyone hears everyone else spatialized at their avatar's position.

Vite + React + TypeScript + react-three-fiber on the client; a Cloudflare
Worker with one Durable Object per room as the multiplayer server; WebRTC
full mesh for audio. No accounts, no database — join with a nickname and a
room code.

## Browser support

**Chromium (Chrome/Edge) first.** Firefox works including Web MIDI. Safari has
never shipped Web MIDI — voice and the raw audio-input instrument still work.

**Headphones are effectively required.** The instrument stream disables echo
cancellation by design (it would eat the music), and Chrome's echo canceller
doesn't reference audio played through Web Audio at all — on speakers, other
players will hear themselves back.

## Develop

```bash
npm install
npm run dev        # one process: Vite + the real Worker/Durable Object in workerd
```

Open http://localhost:5173, create a room, and use a second tab as the second
player. Real microphones/WebRTC across machines need HTTPS — deploy to
`*.workers.dev` for that (`getUserMedia` requires a secure context).

- `npm run typecheck` — all three TS projects (app, worker, vite config)
- `npm run build` — typecheck + production build into `dist/`
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` after
  changing `wrangler.jsonc`

## Deploy

> **Account note:** check `wrangler whoami` before the first deploy — a
> machine-wide `wrangler login` from another project may point at a different
> Cloudflare account. To deploy with the intended (personal) account without
> touching the global login, create an API token in its Cloudflare dashboard
> (template: "Edit Cloudflare Workers") and run:
>
> ```bash
> CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account-id> npm run deploy
> ```
>
> Once known, pin `"account_id"` in `wrangler.jsonc` so a deploy with the
> wrong credentials fails loudly instead of landing on the wrong account.

```bash
npm run deploy     # build + wrangler deploy → https://band-practice.<account>.workers.dev
```

## Adding your own 3D room

Export a glTF binary to `src/assets/room.glb` or an FBX to
`src/assets/room.fbx` — either replaces the placeholder room automatically on
the next dev-server run/build (GLB wins if both exist).

Conventions:

- The floor is `y = 0`; players spawn near the origin at eye height 1.6 m.
- For collision, add **hidden box meshes named `col_*`** around walls and
  furniture. They're stripped from rendering and become collision boxes.
  Player collision is height-blind (a 0.35 m-radius circle on the floor
  plane — don't `col_` anything players should walk under), but carried and
  falling objects (the lamps) use the boxes' vertical span to land on
  tabletops and slide along walls.
- Keep it small; the whole file ships to every visitor.

FBX rooms get extra normalization: centimeter-unit exports are scaled to
meters (lights included), the room is centered on the origin with the floor
at `y = 0`, materials render double-sided so the shell is visible from
inside, and colliders are derived automatically — perimeter walls at the
room bounds plus a solid box per furniture-sized mesh (flat things like rugs
and anything you can walk under are skipped).

Authored `col_*` boxes mix with the derived ones: a mesh that contains the
center of any `col_*` box loses its auto-derived solid block and uses your
boxes instead. So to give a shelf a hollow interior (e.g. so lamps can sit
on its boards), add thin `col_*` boxes for its sides, back, and each board —
every other object keeps its automatic collider.

Avatars are placeholder capsules for now — a rigged `avatar.glb` would slot
into `src/game/RemoteAvatar.tsx`.

## How the audio works (short version)

- Each player publishes **two WebRTC audio tracks** to every peer: the mic
  (voice-processed) and the instrument (raw, stereo, Opus pushed to 256 kbps
  via SDP munging — there is still no proper API for stereo Opus).
- A MIDI keyboard drives an in-browser instrument (sampled pianos/organ via
  [smplr](https://github.com/danigb/smplr), plus a small analog-style synth);
  its output is captured into the instrument track. The "audio input" mode
  captures an interface/line input instead. Either way, remote players hear
  the same stream.
- Incoming tracks are fed through `PannerNode`s (HRTF) positioned at the
  sender's avatar, so proximity and direction are audible.
- Timing reality: internet latency is 30–100 ms+ one way. Loose jamming
  works; tight rhythmic lockstep doesn't — no app can fix the speed of light.

## Known limitations (v1)

- STUN only — roughly 10–15% of peer pairs (symmetric NATs) won't connect;
  fixing that means minting Cloudflare TURN credentials from the Worker.
- No reconnect: a dropped WebSocket returns you to the join screen.
- 8 players per room (WebRTC mesh bandwidth: each player uploads its audio
  to every peer — ~1.3–2 Mbps upstream at a full room).
