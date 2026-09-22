"""Two-user relay for the demonstrator.

Runs the room server-side so both browsers see the same world and the same agent
decisions. It imports the experiment's own modules rather than reimplementing
them:

    state_machine.Session.observation()   builds the observation
    agent.classify() / agent.generate()   decide and answer

That makes the paper's claim a runtime property, not a docstring: what the live
demo feeds the agent is produced by the same code that fed it during the
evaluation. The only difference is the direction of causation — here gaze is
measured from a real head and the addressee is unknown, so `measured_gaze` is
set and `addressee` stays None for the agent to infer.

Run:  python server.py            (serves the page AND the websocket on :8899)
"""
from __future__ import annotations

import asyncio
import http
import json
import logging
import mimetypes
import time
import os
import pathlib
import traceback
import sys

import websockets
from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.http11 import Response

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))
import agent                                    # noqa: E402
from state_machine import Session, Speaker, Turn  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
# Honour PORT so the launcher can assign one; the browser derives the websocket
# URL from location.host, so nothing is pinned to a particular number.
PORT = int(os.environ.get("PORT", "8899"))
# Bind to loopback ONLY. This machine sits on a university network and the relay
# has no authentication whatsoever — 0.0.0.0 would publish the room, and the
# agent behind it, to every host that can route here.
HOST = os.environ.get("HOST", "127.0.0.1")


class _QuietProbes(logging.Filter):
    """Drop handshake tracebacks from liveness probes.

    Launchers check the port with bare TCP connects and HEAD requests. The
    websockets HTTP shim only accepts GET and rejects both inside Request.parse,
    before process_request runs, so they cannot be answered — each one logged a
    full traceback. That buried the agent's own errors and made this log useless
    for debugging, which is the only reason it exists.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return "opening handshake failed" not in record.getMessage()


logging.getLogger("websockets.server").addFilter(_QuietProbes())
SLOTS = ["A", "B"]
DEFAULT_NAMES = {"A": "Maya", "B": "Robin"}
# Live names, replaced by whatever each player typed on the way in. The agent
# addresses people by these, so they are part of the prompt, not decoration.
NAMES = dict(DEFAULT_NAMES)


def clean_name(raw, fallback: str) -> str:
    """Names reach the model's prompt, so keep them short and printable."""
    if not isinstance(raw, str):
        return fallback
    out = " ".join(raw.split())[:24]
    out = "".join(c for c in out if c.isprintable())
    return out or fallback
BACKEND = "agent_backend_1"

clients: dict[str, object] = {}      # role -> websocket
state: dict[str, dict] = {}          # role -> {pos, gaze}
turns: list[Turn] = []
# What the browsers should SHOW. Kept apart from `turns` on purpose: `turns` is
# the model's view and must stay human-only (see the note in handle_speech), so
# the agent's own replies live here and nowhere else. Nothing in this list is
# ever rendered into a prompt.
display_log: list[dict] = []
empty_since: float | None = None
# A refresh empties the room for about a second. Anything longer is a session
# that ended, so the next arrival starts clean rather than inheriting a stranger's
# conversation.
ROOM_RESET_AFTER_S = 30.0
lock = asyncio.Lock()


def live_session() -> Session:
    """A Session whose geometry is whatever the two browsers last reported."""
    attrs = [{"value": "—", "category": "Live"}]
    pos = {"agent": (0.0, 0.0, 0.0)}
    for r in SLOTS:
        p = state.get(r, {}).get("pos", [0, 0, 0])
        pos[r] = (float(p[0]), 0.0, float(p[2]))
    return Session(
        pair_id="LIVE", scenario="Shared room",
        speakers={r: Speaker(r, NAMES[r], "live" * 2, attrs, attrs) for r in SLOTS},
        positions=pos, turns=list(turns),
    )


async def broadcast(msg: dict, exclude: str | None = None):
    dead = []
    for role, ws in clients.items():
        if role == exclude:
            continue
        try:
            await ws.send(json.dumps(msg))
        except Exception:
            dead.append(role)
    for r in dead:
        clients.pop(r, None)


async def handle_speech(role: str, text: str):
    """One turn: build the observation, classify, generate if addressed."""
    async with lock:
        gaze = state.get(role, {}).get("gaze") or {}
        other = "B" if role == "A" else "A"
        # Both browsers report where their own head is pointing, so the
        # listener's gaze is measured too, not assumed. Falling back to "watching
        # the speaker" would quietly author the one signal this demonstration is
        # about - and it would be wrong exactly when it matters, which is when
        # the listener is looking somewhere unexpected.
        other_gaze = (state.get(other, {}).get("gaze") or {}).get("self")
        if not other_gaze:
            other_gaze = role if other in clients else "none"
        # The agent has no head to track; it attends to whoever is speaking.
        measured = {role: gaze.get("self", "none"), other: other_gaze,
                    "agent": role}

        t = Turn(turn=len(turns) + 1, speaker=role, addressee=None,
                 utterance=text, tier=None, expected=None,
                 measured_gaze=measured)
        turns.append(t)
        sess = live_session()
        obs = sess.observation(t)

    display_log.append({"type": "said", "role": role, "name": NAMES[role],
                        "text": text, "observation": obs})
    await broadcast(display_log[-1])

    # agent.classify needs an addressee-free Turn; it only reads the rendering
    loop = asyncio.get_running_loop()
    try:
        d = await loop.run_in_executor(
            None, lambda: agent.classify(sess, t.turn, "P1b", BACKEND))
    except Exception as e:
        traceback.print_exc()
        await broadcast({"type": "agent_error", "error": str(e)[:200]})
        return

    if not d.responded:
        display_log.append({"type": "agent_silent"})
        await broadcast(display_log[-1])
        return
    try:
        reply = await loop.run_in_executor(
            None, lambda: agent.generate(sess, t.turn, "P1b", BACKEND))
    except Exception as e:
        traceback.print_exc()
        await broadcast({"type": "agent_error", "error": str(e)[:200]})
        return
    # The agent's own replies are deliberately NOT appended to `turns`. The
    # experiment's Exp-1 rendering contains human turns only — a placeholder for
    # past agent turns would tell the model which earlier lines were addressed to
    # it, which is the answer key. The demo must render the same way.
    display_log.append({"type": "agent_said", "text": reply})
    await broadcast(display_log[-1])


async def client(ws):
    role = next((r for r in SLOTS if r not in clients), None)
    if role is None:
        await ws.send(json.dumps({"type": "full"}))
        return
    global empty_since
    # An empty room that stayed empty is a finished session, not a refresh.
    if empty_since is not None and not clients:
        if time.monotonic() - empty_since > ROOM_RESET_AFTER_S:
            turns.clear()
            display_log.clear()
    empty_since = None

    clients[role] = ws
    state.setdefault(role, {"pos": [0, 0, 3], "gaze": {}})
    # `history` is what this browser must redraw. Without it a refresh wiped the
    # visible conversation while the agent went on remembering every turn, so
    # the room silently disagreed with itself about what had been said.
    await ws.send(json.dumps({"type": "welcome", "role": role,
                              "name": NAMES[role],
                              "peers": [{"role": r, "name": NAMES[r]}
                                        for r in clients if r != role],
                              "history": display_log[-60:]}))
    await broadcast({"type": "joined", "role": role, "name": NAMES[role]},
                    exclude=role)
    try:
        async for raw in ws:
            m = json.loads(raw)
            if m.get("type") == "pose":
                state[role] = {"pos": m["pos"], "gaze": m.get("gaze", {})}
                await broadcast({"type": "peer", "role": role, "pos": m["pos"],
                                 "yaw": m.get("yaw", 0)}, exclude=role)
            elif m.get("type") == "setname":
                NAMES[role] = clean_name(m.get("name"), DEFAULT_NAMES[role])
                await broadcast({"type": "named", "role": role,
                                 "name": NAMES[role]})
            elif m.get("type") == "say" and m.get("text", "").strip():
                asyncio.create_task(handle_speech(role, m["text"].strip()))
    except websockets.ConnectionClosed:
        pass
    finally:
        clients.pop(role, None)
        NAMES[role] = DEFAULT_NAMES[role]
        if not clients:
            empty_since = time.monotonic()
        await broadcast({"type": "left", "role": role})


async def serve_file(connection, request):
    """Same port serves the page, so there is one thing to run."""
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return None
    path = request.path.split("?")[0]
    name = "index.html" if path in ("/", "") else path.lstrip("/")
    f = (HERE / name).resolve()
    if not f.is_file() or HERE not in f.parents:
        return connection.respond(http.HTTPStatus.NOT_FOUND, "not found\n")
    # connection.respond() is text-only and takes no headers, so build the
    # Response directly — three.min.js must be served as bytes with a type.
    body = f.read_bytes()
    ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
    return Response(200, "OK", Headers([("Content-Type", ctype),
                                        ("Content-Length", str(len(body)))]), body)


async def main():
    print(f"demonstrator on http://localhost:{PORT}  (bound to {HOST})")
    print(f"  open it in TWO browser windows to share the room")
    print(f"  agent backend: {BACKEND}")
    async with serve(client, HOST, PORT, process_request=serve_file):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
