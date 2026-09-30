"""Gaze-instruction ablation — is 91% deference a finding or a prompt artifact?

The agent was never told anything about the spatial channel: not what it means,
not that it can be wrong, not how to weigh it against the words. It inferred on
its own that "looking at you" implies being addressed, and then treated that as
decisive. A reviewer can reasonably ask whether the deference would survive being
warned.

This runs the SAME incongruent trap items under three prompts:

  baseline   exactly what the main experiment used (no mention of gaze)
  warned     gaze named as a cue that is sometimes wrong
  adversarial gaze named AND the failure mode spelled out

Everything else is held fixed — same transcripts, same items, same condition,
same backend, same temperature. Only the system prompt varies.

Reported per arm: accuracy on incongruent traps, and the share of decisions that
followed gaze rather than language. Congruent traps are run too, so a drop in
deference cannot be mistaken for the model simply ignoring the channel.
"""
from __future__ import annotations

import argparse
import csv
import json
import time

import agent
import llm
import paths
from state_machine import session_from_dict

ARMS = {
    "baseline": agent.CLASSIFY_SYSTEM,

    "warned": agent.CLASSIFY_SYSTEM + """

The notes about where people are looking are a cue, not a guarantee. They are
often informative but sometimes wrong. Weigh them against what is actually
said.""",

    "adversarial": agent.CLASSIFY_SYSTEM + """

The notes about where people are looking are a cue, not a guarantee. People
sometimes look away from you while speaking to you, and sometimes look at you
while speaking to each other. When the direction of gaze and the wording of the
utterance disagree, decide from the wording and the conversation, not from the
gaze.""",
}


def classify_with(system, session, turn_index, condition, backend):
    body = session.render(condition, upto=turn_index, experiment=1)
    task = agent.CLASSIFY_TASK.format(turn=turn_index)
    try:
        r = llm.call_json(
            backend,
            [{"role": "system", "content": system},
             {"role": "user", "content": f"{body}\n\n{task}"}],
            schema_hint='{"respond": true}', max_tokens=40)
        v = r.get("respond")
        if isinstance(v, str):
            v = v.strip().lower() in ("true", "yes", "1")
        return bool(v), False
    except llm.ProviderError:
        return False, True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="agent_backend_1")
    ap.add_argument("--condition", default="P1b")
    ap.add_argument("--out", default="ablation_gaze_prompt.csv")
    args = ap.parse_args()

    sessions = [session_from_dict(d) for d in
                json.load(open(paths.DATA / "transcripts.json", encoding="utf-8"))]
    items = [(s, t) for s in sessions for t in s.turns if t.tier == "trap"]
    inc = [(s, t) for s, t in items if not t.gaze_congruent]
    con = [(s, t) for s, t in items if t.gaze_congruent]
    print(f"{len(inc)} incongruent + {len(con)} congruent traps x {len(ARMS)} arms "
          f"= {(len(inc)+len(con))*len(ARMS)} calls\n")

    out = paths.OUTPUT / args.out
    f = open(out, "w", newline="", encoding="utf-8")
    w = csv.DictWriter(f, fieldnames=[
        "arm", "pair_id", "turn_id", "gaze_congruent", "expected",
        "responded", "correct", "signal_followed", "parse_failed"])
    w.writeheader()

    stats = {}
    for arm, system in ARMS.items():
        t0 = time.time()
        rows = []
        for s, t in inc + con:
            responded, pf = classify_with(system, s, t.turn, args.condition,
                                          args.backend)
            rows.append({
                "arm": arm, "pair_id": s.pair_id, "turn_id": t.turn,
                "gaze_congruent": t.gaze_congruent, "expected": t.expected,
                "responded": responded,
                "correct": responded == (t.expected == "respond"),
                "signal_followed": t.signal_followed(responded),
                "parse_failed": pf,
            })
        w.writerows(rows)
        f.flush()

        i_rows = [r for r in rows if not r["gaze_congruent"]]
        c_rows = [r for r in rows if r["gaze_congruent"]]
        gz = [r for r in i_rows if r["signal_followed"] in ("gaze", "language")]
        follow = sum(1 for r in gz if r["signal_followed"] == "gaze")
        stats[arm] = {
            "inc_acc": sum(r["correct"] for r in i_rows) / max(len(i_rows), 1),
            "con_acc": sum(r["correct"] for r in c_rows) / max(len(c_rows), 1),
            "gaze_follow": follow / max(len(gz), 1),
            "n_inc": len(i_rows), "n_con": len(c_rows),
            "secs": time.time() - t0,
        }
        st = stats[arm]
        print(f"  {arm:<12} incongruent {st['inc_acc']*100:5.1f}%   "
              f"congruent {st['con_acc']*100:5.1f}%   "
              f"followed gaze {st['gaze_follow']*100:5.1f}%   "
              f"({st['secs']:.0f}s)", flush=True)
    f.close()

    print(f"\n{'='*66}\nVERDICT\n{'='*66}")
    b, a = stats["baseline"], stats["adversarial"]
    drop = (b["gaze_follow"] - a["gaze_follow"]) * 100
    print(f"  gaze-following: baseline {b['gaze_follow']*100:.1f}%  ->  "
          f"adversarial {a['gaze_follow']*100:.1f}%   ({drop:+.1f}pp)")
    if drop < 10:
        print("  -> DEFERENCE PERSISTS despite being told the cue can mislead.")
        print("     The 91% is a property of the model, not of the prompt.")
    else:
        print("  -> deference is PROMPT-SENSITIVE. The finding becomes 'models")
        print("     over-trust an uninstructed spatial cue', with an available fix.")
    print(f"\n  congruent-trap accuracy: baseline {b['con_acc']*100:.1f}%  ->  "
          f"adversarial {a['con_acc']*100:.1f}%")
    print("  (if this collapses, the warning made it ignore the channel entirely")
    print("   rather than weigh it — a different result from balanced integration)")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
