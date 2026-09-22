/* Push-to-talk.
 *
 * Hold V, speak, release. The point of holding a key rather than clicking a
 * button is that the mouse stays captured, so you keep looking at whoever you
 * are addressing while you talk. That is the behaviour the whole demonstrator
 * exists to show; clicking a mic would force you to look away to use it.
 *
 * Uses the browser's built-in recognition, so there is no key and no install.
 * Chrome and Edge send the audio to Google's servers to transcribe it, which is
 * why this is OPT-IN and typing remains the default: a reviewer opening the
 * artifact never has to enable a microphone or send audio anywhere.
 */
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const pill = document.getElementById("pVoice");
  if (!pill) return;

  if (!SR || !window.isSecureContext) {
    pill.textContent = !SR ? "voice: not in this browser" : "voice: needs https";
    pill.title = !SR
      ? "Chrome or Edge support speech input. Typing works everywhere."
      : "Speech input needs a secure page (https, or localhost).";
    return;
  }

  let rec = null, holding = false, armed = false, interim = "";

  function setPill(state, text) {
    pill.textContent = text;
    pill.className = "pill" + (state ? " " + state : "");
  }
  setPill("", "voice: hold V");

  function build() {
    const r = new SR();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = e => {
      let finalText = "";
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      if (finalText) say.value = (say.value + " " + finalText).trim();
      say.placeholder = interim ? "… " + interim : say.dataset.ph;
    };
    r.onerror = ev => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        armed = false;
        setPill("", "voice: microphone blocked");
        pill.title = "Allow microphone access in the browser to use push-to-talk.";
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") {
        setPill("", "voice: " + ev.error);
      }
    };
    r.onend = () => { if (holding) { try { r.start(); } catch (e) {} } };
    return r;
  }

  function start() {
    if (holding) return;
    holding = true;
    say.dataset.ph = say.dataset.ph || say.placeholder;
    if (!rec) rec = build();
    try { rec.start(); armed = true; setPill("on", "voice: listening…"); }
    catch (e) { /* already running */ }
  }

  function stop() {
    if (!holding) return;
    holding = false;
    try { rec && rec.stop(); } catch (e) {}
    say.placeholder = say.dataset.ph || say.placeholder;
    if (armed) setPill("", "voice: hold V");
    // Send what was heard. Speaking then releasing is one utterance, the same
    // as typing then pressing Enter.
    const text = (say.value || "").trim();
    if (text) sendUtterance(text);
  }

  addEventListener("keydown", e => {
    if (e.code !== "KeyV" || e.repeat) return;
    if (document.activeElement === say || document.activeElement === nameIn) return;
    e.preventDefault(); start();
  });
  addEventListener("keyup", e => {
    if (e.code !== "KeyV") return;
    e.preventDefault(); stop();
  });
  // releasing V outside the window would otherwise leave it stuck listening
  addEventListener("blur", stop);
})();
