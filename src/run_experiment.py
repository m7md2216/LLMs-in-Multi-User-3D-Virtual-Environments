"""Run the agent over transcripts and write the results table.

One row per (pair_id, turn_id, condition, backend). Every reported measure must be
derivable from this table without re-running, so rows carry the design fields
alongside the outcome.

Resumable: rows already present in the output CSV are skipped, so an interrupted
run costs only the calls it had not yet made. Combined with the response cache in
llm.py, re-running is close to free.
"""
from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter, defaultdict

import agent
import llm
import paths
from state_machine import CONDITIONS, session_from_dict

EXP2_FIELDS = [
    "pair_id", "turn_id", "condition", "backend", "scenario",
    "content_type", "referent", "attribute_targeted", "reference_style",
    "addressee_name", "referent_name", "over_disclosure_eligible",
    "utterance", "response_text",
]

FIELDS = [
    "pair_id", "turn_id", "condition", "backend", "scenario",
    "tier", "expected_behavior", "addressee", "content_type",
    "referent", "attribute_targeted", "reference_style",
    "gaze_congruent", "signal_followed", "responded", "response_text",
    "correct", "parse_failed",
]


def load_done(path):
    if not path.exists():
        return set()
    with open(path, newline="", encoding="utf-8") as f:
        return {(r["pair_id"], int(r["turn_id"]), r["condition"], r["backend"])
                for r in csv.DictReader(f)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=10, help="how many dyads")
    ap.add_argument("--backend", default="agent_backend_1")
    ap.add_argument("--conditions", default=",".join(CONDITIONS))
    ap.add_argument("--out", default=str(paths.OUTPUT / "results.csv"))
    ap.add_argument("--exp", type=int, default=1, choices=(1, 2),
                    help="1 = classify every turn; 2 = forced response at "
                         "agent-directed turns only")
    args = ap.parse_args()

    conds = [c.strip() for c in args.conditions.split(",")]
    sessions = [session_from_dict(d) for d in
                json.load(open(paths.DATA / "transcripts.json", encoding="utf-8"))
                ][:args.pairs]
    out = paths.OUTPUT / args.out if not args.out.startswith("/") else None
    out = out or __import__("pathlib").Path(args.out)
    done = load_done(out)

    per_session = 30 if args.exp == 1 else len(sessions[0].exp2_turns())
    total = len(sessions) * len(conds) * per_session
    print(f"{len(sessions)} dyads x {len(conds)} conditions x 30 turns = {total} turns")
    print(f"already done: {len(done)}   backend: {args.backend}\n")

    fields = FIELDS if args.exp == 1 else EXP2_FIELDS
    new = out.exists()
    f = open(out, "a", newline="", encoding="utf-8")
    w = csv.DictWriter(f, fieldnames=fields)
    if not new:
        w.writeheader()

    t0, n = time.time(), 0
    for s in sessions:
        for cond in conds:
            turns = s.turns if args.exp == 1 else s.exp2_turns()
            for turn in turns:
                key = (s.pair_id, turn.turn, cond, args.backend)
                if key in done:
                    continue
                row = (agent.run_turn if args.exp == 1
                       else agent.run_exp2_turn)(s, turn, cond, args.backend)
                w.writerow({k: row.get(k) for k in fields})
                n += 1
                if n % 50 == 0:
                    f.flush()
                    rate = n / max(time.time() - t0, 1)
                    left = (total - len(done) - n) / max(rate, 0.01) / 60
                    print(f"  {n:>5}/{total-len(done)}  {rate:4.1f} turns/s  "
                          f"eta {left:5.1f}m", flush=True)
        print(f"  [{s.pair_id}] done", flush=True)
    f.close()

    print(f"\nwrote {out}")
    print(f"\n{llm.report()}")


if __name__ == "__main__":
    main()
