/* Multi-user mode.
 *
 * If a relay is reachable the room is shared: poses go up, the peer avatar is
 * driven by the server, and the AGENT RUNS SERVER-SIDE using the experiment's
 * own state_machine.py and agent.py. Both browsers then see the same decision,
 * and the observation the agent saw was built by the evaluation code itself.
 *
 * With no relay the page stays single-user and the browser-side agent handles
 * things, so opening the file directly still works.
 */
let net = null, myRole = "A", myName = "Maya", netReady = false;

function netLog(t, cls="sil") { post("", t, cls); }

/* Reconnect state. A relay that has worked once is expected back: the laptop
 * sleeps, the server restarts during development, the socket idles out. Without
 * this the page drops to single-user for good and the room looks broken with
 * only one line of explanation. A relay that has NEVER answered is just
 * single-user mode, so give up quietly rather than retrying forever. */
let everConnected = false, retryMs = 500, coldTries = 0;
// roomFull: the relay turned this window away. relayGaveUp: there is no relay
// at all. agent.js waits on these before choosing a backend.
let roomFull = false, relayGaveUp = false;
/* The name the player typed. The server hands the slot back to its default name
 * when a socket drops, so this has to be re-asserted on every welcome or a
 * reconnect silently renames you mid-session. */
let chosenName = null;
const MAX_COLD_TRIES = 3, MAX_RETRY_MS = 8000;

function connectRelay() {
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/";
  let ws;
  try { ws = new WebSocket(url); } catch (e) { relayGaveUp = true; return; }

  ws.onopen = () => { net = ws; retryMs = 500; };
  ws.onerror = () => { net = null; };
  ws.onclose = () => {
    const wasUp = netReady;
    net = null; netReady = false;
    if (wasUp) netLog("Relay disconnected — reconnecting…");
    if (!everConnected && ++coldTries > MAX_COLD_TRIES) { relayGaveUp = true; return; }  // single-user
    setTimeout(connectRelay, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    switch (m.type) {
      case "welcome":
        const rejoin = everConnected;
        everConnected = true; coldTries = 0;
        myRole = m.role; myName = m.name; netReady = true;
        // With two windows open on the same URL they are otherwise
        // indistinguishable; name the player in the tab title and the HUD.
        document.title = m.name + " — Co-presence demonstrator";
        const who = document.getElementById("pWho");
        who.textContent = "you are: " + m.name;
        who.className = "pill " + (m.role === "A" ? "me-a" : "me-b");
        const peerRoleId = m.role === "A" ? "B" : "A";
        const known = (m.peers || []).find(p => p && p.role === peerRoleId);
        if (typeof setPeerName === "function")
          setPeerName(known ? known.name : (m.role === "A" ? "Robin" : "Maya"), peerRoleId);
        const nf = document.getElementById("nameIn");
        if (nf && !nf.value) nf.value = m.name;
        if (chosenName && chosenName !== m.name) netSetName(chosenName);
        document.getElementById("pAgent").textContent = "agent: server-side";
        // Redraw whatever was said before this browser loaded. The relay keeps
        // the conversation, so a refresh must not leave the two out of step.
        if (m.history && m.history.length) {
          for (const h of m.history) {
            if (h.type === "said") {
              post(h.name, h.text);
              lastSpeaker = h.role === m.role ? "me" : "peer";
            }
            else if (h.type === "agent_said") post("Assistant", h.text, "ai");
            else if (h.type === "agent_silent")
              post("", "assistant stayed silent — it heard this, but did not take it as addressed to it", "sil");
          }
          const last = m.history[m.history.length - 1];
          if (last && last.observation) paintObs(last.observation);
          netLog("— earlier conversation restored —");
        }
        if (rejoin) { netLog(`Reconnected as ${chosenName || m.name}.`); break; }
        netLog("Connected to the shared room." +
               (m.peers.length ? ` ${m.peers[0].name} is already here.`
                               : " Open this page in a second window to join as the other person."));
        setInterval(sendPose, 100);
        break;
      case "joined":
        netLog(`${m.name} joined the room.`);
        if (typeof setPeerName === "function") setPeerName(m.name, m.role);
        break;
      case "named":
        if (m.role === myRole) {
          myName = m.name;
          document.title = m.name + " — Co-presence demonstrator";
          document.getElementById("pWho").textContent = "you are: " + m.name;
        } else if (typeof setPeerName === "function") {
          setPeerName(m.name, m.role);
          netLog(`They are called ${m.name}.`);
        }
        break;
      case "left":   netLog("The other person left."); break;
      case "full":
        // A third window. Say so on the entry card, where the person is looking;
        // the chat log sits behind it. And do not fall back to single-user: that
        // made "Enter the room" look dead and started a 1 GB model download.
        roomFull = true;
        ws.onclose = null; ws.close();
        showRoomFull();
        break;
      case "peer":
        // the server owns the other avatar's position; we only draw it
        other.position.set(m.pos[0], 0, m.pos[2]);
        // Set all three, not just Y. Before the relay connects the peer is
        // posed with lookAt(), which writes a full rotation including a tilt
        // toward the camera's height; overwriting Y alone left that tilt behind
        // and the avatar stayed leaning over for the rest of the session.
        other.rotation.set(0, m.yaw ?? other.rotation.y, 0);
        break;
      case "said":
        if (m.role !== myRole) { post(m.name, m.text); lastSpeaker = "peer"; }
        paintObs(m.observation);   // the observation the AGENT actually saw
        break;
      case "agent_said":   post("Assistant", m.text, "ai"); break;
      case "agent_silent":
        post("", "assistant stayed silent — it heard this, but did not take it as addressed to it", "sil");
        break;
      case "agent_error":  netLog("agent error: " + m.error); break;
    }
  };
}

function showRoomFull() {
  const who = document.getElementById("veilWho");
  if (who) who.textContent = "This room already has two people. Close one of the " +
    "other windows or tabs showing this page, then reload this one.";
  // Swap the button for a clean copy so its "enter" listener goes with it.
  const old = document.getElementById("enterBtn");
  if (old) {
    const btn = old.cloneNode(true);
    btn.textContent = "Reload";
    btn.addEventListener("click", e => { e.stopPropagation(); location.reload(); });
    old.replaceWith(btn);
  }
  if (typeof entered !== "undefined") entered = false;
  document.getElementById("veil").style.display = "flex";
  const pill = document.getElementById("pAgent");
  pill.textContent = "agent: room full"; pill.className = "pill";
}

function sendPose() {
  if (!net || net.readyState !== 1) return;
  const g = gazeFrom(camera.position, camera.quaternion,
    [{id:"agent", obj:robot}, {id:"peer", obj:other}]);
  net.send(JSON.stringify({
    type: "pose",
    pos: [+camera.position.x.toFixed(2), 0, +camera.position.z.toFixed(2)],
    // The avatar's face is its -Z side, which is also the direction this yaw
    // means, so it is sent as-is. Adding PI here drew every peer turned exactly
    // backwards: their nose pointed away from whoever they were looking at.
    yaw: +yaw.toFixed(3),
    // "self" is this player's gaze target; the server maps peer/agent to roles
    gaze: {self: g === "peer" ? (myRole === "A" ? "B" : "A") : (g || "none")},
  }));
}

/* Announce the name the player typed. Harmless when offline. */
function netSetName(name) {
  chosenName = name;
  myName = name;
  document.title = name + " — Co-presence demonstrator";
  const w = document.getElementById("pWho");
  if (w) w.textContent = "you are: " + name;
  if (net && net.readyState === 1) net.send(JSON.stringify({type: "setname", name}));
}

/* demo.js calls this; it returns true if the relay took the utterance.
 *
 * The pose is re-sent FIRST, on the same tick. The periodic sendPose is clamped
 * by the browser (to ~1/s in a background tab), so without this the relay could
 * classify the turn against a head pose up to a second old — turning to face
 * someone and speaking immediately would be scored against the previous target.
 * That is precisely the manipulation the demonstration exists to show, so the
 * pose that the agent sees must be the pose at the instant of speaking. */
function netSay(text) {
  if (!netReady || !net || net.readyState !== 1) return false;
  sendPose();
  net.send(JSON.stringify({type: "say", text}));
  return true;
}

connectRelay();
