# Co-presence demonstrator

A shared virtual room with two people and one assistant. The assistant decides
**for itself** whether each thing it hears was meant for it. Nobody labels the
addressee. The only extra signal it gets is where the speaker's head is pointing.

This is the interactive companion to the paper's experiments. It is not a
re-implementation: the page hands its observations to the **same
`state_machine.py` and `agent.py` used to produce every number we report**.

## The thing to try

Stand somewhere, look at the robot, and say:

> What about that place you mentioned earlier?

It answers. Now turn your head toward the other person and type the **exact same
sentence**. It stays quiet.

The words never changed. Only your head did.

## Run it

Single user, no install, no server:

```bash
open demo/index.html
```

Two users in one room, with the agent running the paper's own code:

```bash
python demo/server.py
```

Then open <http://localhost:8899> in **exactly two** windows. First window is
Maya, second is Robin. Both see one shared room and one shared decision.

The room holds two people. A third window is told the room is full — that is not
a bug. Each window names its player in the tab title and in the coloured pill at
the top-left ("you are: Maya"), so several windows open at once stay easy to
tell apart.

## Where the agent's answers come from

Three tiers, tried in order, so the page works anywhere:

1. **A relay running the experiment's code** — used whenever `server.py` is up.
   This is the honest configuration and the one the paper describes.
2. **A local Ollama**, if the browser can reach one. Useful offline; the pill at
   the top names the model so nobody mistakes it for a paper backend.
3. **A small rule-based stand-in**, so the interaction still demonstrates without
   any model at all. Clearly labelled when active.

The badge in the top-left always states which tier is live.

## The panel on the right

That is the live observation — the exact structure the experiment consumes, with
the same sixteen fields. `src/test_demo_schema.py` asserts that the demo and the
experiment emit identical shapes, so what you see here is what the model saw
during evaluation.

Two fields matter most:

- `gaze` is **measured**, not written. It comes from the camera's forward vector
  and a 22° cone, recomputed the moment you press Enter.
- `addressee` stays `null`. The agent never gets told. Inferring it is the task.

Every authored field the experiment uses to *score* a turn — `tier`, `expected`,
`gaze_congruent`, `referent` — is `null` here, because live speech has no ground
truth. The demo shows the mechanism; the paper measures it.

## Files

| file | what it does |
|---|---|
| `index.html` | page shell, HUD, observation panel |
| `demo.js` | scene, movement, and the gaze measurement |
| `agent.js` | the three-tier backend selection |
| `net.js` | multi-user: poses up, shared decisions down |
| `server.py` | static server + websocket relay; imports the experiment's code |
| `vendor/avatars.js` | the two people, embedded as binary glTF (see Credits) |
| `vendor/GLTFLoader.js` | three.js r160 glTF loader, converted to a plain script |

## Controls

Looking around uses pointer lock, which browsers refuse inside an embedded
frame — a preview pane, an `<iframe>` — and which a user can decline anywhere.
Where it is unavailable the page falls back to click-and-drag to look, so the
room stays explorable; open the page directly in a browser tab for the captured
mouse.

`Enter` opens the message box; `Enter` again sends and hands the mouse straight
back, so you can turn and look without touching anything else. The Send button
is the mouse equivalent and keeps the box focused for a second message.

The relay owns the conversation, so refreshing a browser no longer loses it: the
page is sent what was said and redraws it. Previously a refresh cleared only what
you could see while the agent went on remembering every turn, which left the room
disagreeing with itself. A room that stays empty for 30 seconds is treated as a
finished session and starts clean; a refresh takes about a second, so it keeps
the history.

`Enter` puts the cursor in the message box. `Esc` gives the mouse back so you can
look around. There is also a Send button, so nothing depends on a key working.

Hold `V` to talk instead of typing. Holding a key rather than clicking a mic
button is deliberate: the mouse stays captured, so you keep looking at whoever
you are addressing while you speak, which is the behaviour being demonstrated.
Voice uses the browser's built-in recogniser — Chrome and Edge send the audio to
Google to transcribe it, so it is opt-in and typing remains the default. The
pill in the top bar says `voice: not in this browser` where it is unavailable.

Each player types their own name on the way in. The name is sent to the other
browser and used by the agent, so it appears in the prompt, not just on screen.
It is re-asserted after a reconnect.

## What you should see

Say the same ambiguous sentence twice, changing only where you look:

    looking at the other person  ->  the assistant stays silent
    looking at the assistant     ->  the assistant answers

Nothing about the sentence changes. The beam and the ring on the floor show
where the *other* person is looking, derived from their reported head pose — so
the signal the agent is acting on is visible in a screenshot.

## Notes

`server.py` binds to **127.0.0.1 only**. The relay has no authentication at all,
so binding it to every interface would publish the room — and the agent behind
it — to anything that can route to this machine. Set `HOST` to override, but not
on a shared or campus network.

The port comes from `PORT` (default 8899). Nothing is pinned to a number: the
page derives its websocket address from wherever it was served.

If the relay goes away — laptop sleeps, server restarts — the page retries on its
own and rejoins with the same identity. It does not silently die in single-user
mode. If it never reaches a relay at all, it stops after three tries and stays
single-user, which is the correct behaviour when you opened the file directly.

The server holds no state across restarts, keeps at most two players, and stores
nothing on disk.

To see what is holding the port, match the **listener** specifically:

```bash
lsof -nP -iTCP:8899 -sTCP:LISTEN
```

Do not use `lsof -ti:8899 | xargs kill -9`. That form also matches *clients*
connected to the port, including your browser's network process.

## Credits

- **People:** the "Casual" characters from Quaternius's *Ultimate Modular Men*
  and *Ultimate Modular Women* packs (<https://quaternius.com>), released under
  **CC0 1.0** - public domain, no attribution required; credited anyway.
  Repacked as binary glTF keeping only the Idle and Walk clips; every other
  animation in the packs, including all weapon clips, was removed.
- **glTF loader:** three.js r160 `GLTFLoader` (MIT licence, (c) three.js
  authors), converted from an ES module to a plain script so the page still
  opens from `file://`. The conversion only rewires imports and the export.
- If `vendor/` is missing, the page falls back to the built-in block figures.

