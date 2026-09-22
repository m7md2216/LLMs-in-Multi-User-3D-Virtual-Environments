/* The agent, using the SAME prompts as src/agent.py.
 *
 * Three ways to get a reply, tried in order:
 *   1. local Ollama  — the real system, identical models to the paper
 *   2. in-browser LLM — so a reviewer clicking a link gets live replies with
 *                       nothing installed
 *   3. rule fallback  — gaze-only, clearly labelled, so the page still
 *                       demonstrates the observation pipeline if both fail
 *
 * Classification is a separate call from generation, exactly as in the paper:
 * a model that writes a reply first has already committed to answering.
 */
const OLLAMA = "http://127.0.0.1:11434";
// Preference order. Whatever the reviewer happens to have is fine — the point of
// the demo is the observation pipeline, not which model answers. Checking
// /api/tags rather than /api/version matters: an Ollama that is running but does
// not hold the model would otherwise report a model it cannot serve.
const MODEL_PREFS = ["qwen3.6:27b", "mistral-small3.2:24b", "nemotron3:33b",
                     "gemma4:31b", "granite4.1:8b", "phi4-reasoning:14b"];
let OLLAMA_MODEL = null;

const CLASSIFY_SYSTEM =
`You are an assistant in a room with two people who are talking to each other
and occasionally to you. Most utterances are NOT for you. Only respond when
someone is addressing you directly. If two people are talking to each other,
stay silent.`;

const GENERATE_SYSTEM =
`You are a helpful assistant in a room with two people. Answer the person who
just addressed you, briefly and naturally — two or three sentences. Speak to
them directly. Do not narrate, do not describe yourself, do not use their name
more than once.`;

/* Renders the conversation the way state_machine.render(..., "P1b") does:
   each line, then a spatial line beneath it. "you" means the assistant. */
function renderConversation(obs, utterance) {
  const lines = [];
  for (const h of convo.slice(0, -1).slice(-8)) {
    lines.push(`[T${h.turn ?? "-"}] ${h.speaker}: "${h.text}"`);
    if (h.gaze) lines.push("     " + h.gaze);
  }
  const who = g => g === "agent" ? "you" : g === "B" ? "Robin" : "Maya";
  const spatial = `Maya ${obs.distances.A}m, looking at ${who(obs.gaze.A)} | ` +
                  `Robin ${obs.distances.B}m, looking at ${who(obs.gaze.B)}`;
  lines.push(`[T${obs.turn}] Maya: "${utterance}"`);
  lines.push("     " + spatial);
  if (convo.length) convo[convo.length-1].gaze = spatial;
  const out = "You are an assistant in a room with two people: Maya and Robin.\n\n" +
              "CONVERSATION:\n" + lines.join("\n");
  window.__lastPrompt = out;
  return out;
}

let backend = null;   // "ollama" | "webllm" | "rule"
let webllm = null;

async function detectBackend() {
  try {
    const r = await fetch(OLLAMA + "/api/tags", {signal: AbortSignal.timeout(1500)});
    if (!r.ok) return "webllm";
    const names = (await r.json()).models.map(m => m.name);
    if (!names.length) return "webllm";
    OLLAMA_MODEL = MODEL_PREFS.find(m => names.includes(m)) || names[0];
    return "ollama";
  } catch (e) {}
  return "webllm";
}

async function ollamaChat(system, user, maxTok) {
  const r = await fetch(OLLAMA + "/api/chat", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      model: OLLAMA_MODEL, stream: false, think: false,
      messages: [{role:"system", content:system}, {role:"user", content:user}],
      options: {temperature: 0, num_ctx: 8192, num_predict: maxTok},
    }),
  });
  const d = await r.json();
  return (d.message && d.message.content || "").trim();
}

async function loadWebLLM(onProgress) {
  const mod = await import("https://esm.run/@mlc-ai/web-llm");
  return await mod.CreateMLCEngine("Llama-3.2-1B-Instruct-q4f32_1-MLC",
    {initProgressCallback: p => onProgress(p.text || "")});
}

async function webllmChat(system, user, maxTok) {
  const r = await webllm.chat.completions.create({
    messages: [{role:"system", content:system}, {role:"user", content:user}],
    temperature: 0, max_tokens: maxTok,
  });
  return (r.choices[0].message.content || "").trim();
}

async function chat(system, user, maxTok) {
  if (backend === "ollama") return ollamaChat(system, user, maxTok);
  if (backend === "webllm") return webllmChat(system, user, maxTok);
  throw new Error("no backend");
}

/* One turn: classify, then generate only if addressed. */
async function agentTurn(obs, utterance) {
  const pill = document.getElementById("pAgent");
  const prompt = renderConversation(obs, utterance);
  convo[convo.length-1].turn = obs.turn;

  if (backend === "rule") {
    const yes = obs.gaze.A === "agent";
    pill.textContent = "agent: rule (no model)";
    return yes ? post("Assistant", "(rule mode — no model available to answer)", "ai")
               : post("", "assistant stayed silent", "sil");
  }

  pill.textContent = "agent: deciding…"; pill.className = "pill on";
  let respond = false;
  try {
    const out = await chat(CLASSIFY_SYSTEM, prompt +
      `\n\nBased on the conversation above, is the FINAL line (turn ${obs.turn}) addressed to\n` +
      `you, the assistant?\n\nAnswer with JSON only: {"respond": true} if it is addressed to you, or\n` +
      `{"respond": false} if the two people are talking to each other.`, 40);
    const m = out.match(/"respond"\s*:\s*(true|false)/i);
    respond = m ? m[1].toLowerCase() === "true" : /\btrue\b/i.test(out);
  } catch (e) {
    pill.textContent = "agent: error"; post("", "classification failed: " + e.message, "sil");
    return;
  }

  if (!respond) {
    pill.textContent = "agent: stayed silent"; pill.className = "pill";
    post("", "assistant stayed silent — it heard this, but did not take it as addressed to it", "sil");
    return;
  }

  pill.textContent = "agent: replying…";
  try {
    const reply = await chat(GENERATE_SYSTEM, prompt +
      `\n\nTurn ${obs.turn} is addressed to you. Write your reply.`, 200);
    post("Assistant", reply.replace(/^["']|["']$/g, ""), "ai");
    convo.push({speaker:"Assistant", text:reply, turn:obs.turn});
  } catch (e) {
    post("", "generation failed: " + e.message, "sil");
  }
  pill.textContent = "agent: idle"; pill.className = "pill";
}

/* Boot: pick a backend and tell the user which one is live. */
(async () => {
  const pill = document.getElementById("pAgent");
  // In multi-user mode the relay runs the agent with the experiment's own
  // code; do not claim a local backend that will never be used.
  // Wait for the relay's actual answer rather than a fixed pause. A window that
  // was welcomed after the old 900 ms guess, or turned away because the room was
  // full, fell through to a local model and started a 1 GB download.
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    if (typeof netReady !== "undefined" && netReady) break;
    if (typeof roomFull !== "undefined" && roomFull) break;
    if (typeof relayGaveUp !== "undefined" && relayGaveUp) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (typeof roomFull !== "undefined" && roomFull) return;   // the entry card explains
  if (typeof netReady !== "undefined" && netReady) {
    pill.textContent = "agent: server-side (experiment code)";
    pill.className = "pill on"; backend = "relay"; return;
  }
  backend = await detectBackend();
  if (backend === "ollama") {
    pill.textContent = `agent: ${OLLAMA_MODEL} (local)`; pill.className = "pill on";
    const paperModel = MODEL_PREFS.slice(0,3).includes(OLLAMA_MODEL);
    post("", `Connected to local Ollama, using ${OLLAMA_MODEL}` +
            (paperModel ? " — one of the models the paper evaluated."
                        : " — note this is not one of the paper's three backends."), "sil");
    return;
  }
  pill.textContent = "agent: loading in-browser model…";
  post("", "No local Ollama found. Downloading a small in-browser model (~1 GB, once). " +
          "Replies will be live but from a much smaller model than the paper used.", "sil");
  try {
    webllm = await loadWebLLM(t => pill.textContent = "agent: " + t.slice(0, 40));
    pill.textContent = "agent: Llama-3.2-1B (in-browser)"; pill.className = "pill on";
    post("", "In-browser model ready.", "sil");
  } catch (e) {
    backend = "rule";
    pill.textContent = "agent: rule fallback";
    post("", "In-browser model unavailable (" + e.message + "). The scene and the live " +
            "observation panel still work; agent replies are disabled.", "sil");
  }
})();
