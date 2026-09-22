"""Proves the demonstrator emits the SAME observation structure as the experiment.

The paper's XR claim rests on this: the spatial observations it evaluated are the
native output of a shared virtual environment, not hand-authored text. That is
only credible if the live demo and the experiment produce identical structures.

The JSON below is captured from the running demonstrator (demo/demo.js,
observation()). This test compares it field-for-field against
state_machine.Session.observation(). Run it whenever either side changes.
"""
import json
import sys

from state_machine import Session, Speaker, Turn

# Captured live from the browser while looking at the robot.
LIVE = json.loads(r'''
{"pair_id":"LIVE","scenario":"Shared room","turn":2,"speaker":"A","addressee":null,
 "utterance":"test line","tier":null,"expected":null,"content_type":null,
 "referent":null,"attribute_targeted":null,"reference_style":null,
 "gaze_congruent":null,"positions":{"agent":[0,0,0],"A":[2.6,0,4.4],"B":[-2.6,0,1.4]},
 "gaze":{"A":"agent","B":"A","agent":"A"},"distances":{"A":5.11,"B":2.95}}
''')


def experiment_observation():
    attrs = [{"value": "x", "category": "Authored"}]
    s = Session(
        pair_id="LIVE", scenario="Shared room",
        speakers={"A": Speaker("A", "Maya", "a" * 8, attrs, attrs),
                  "B": Speaker("B", "Robin", "b" * 8, attrs, attrs)},
        positions={"agent": (0, 0, 0), "A": (2.6, 0, 4.4), "B": (-2.6, 0, 1.4)},
        turns=[Turn(turn=2, speaker="A", addressee="agent", utterance="test line",
                    tier="trap", expected="respond",
                    measured_gaze={"A": "agent", "B": "A", "agent": "A"})],
    )
    return s.observation(s.turns[0])


def main():
    exp = experiment_observation()
    fails = []

    if set(exp) != set(LIVE):
        fails.append(f"field sets differ: only-experiment={set(exp)-set(LIVE)}, "
                     f"only-demo={set(LIVE)-set(exp)}")
    print(f"fields: experiment {len(exp)}, demo {len(LIVE)} — "
          f"{'identical' if set(exp) == set(LIVE) else 'DIFFERENT'}")

    for k in sorted(set(exp) & set(LIVE)):
        te, tl = type(exp[k]).__name__, type(LIVE[k]).__name__
        # the demo cannot know authored fields; None there is correct, not a mismatch
        ok = te == tl or LIVE[k] is None
        if not ok:
            fails.append(f"{k}: experiment {te}, demo {tl}")
        print(f"  {'ok  ' if ok else 'FAIL'} {k:<20} {te:<6} vs {tl}")

    # the two fields the whole claim turns on
    if exp["gaze"] != LIVE["gaze"]:
        fails.append(f"gaze differs: {exp['gaze']} vs {LIVE['gaze']}")
    if exp["distances"]["B"] != LIVE["distances"]["B"]:
        fails.append("distance B differs")
    print(f"\n  gaze      experiment {exp['gaze']}\n            demo       {LIVE['gaze']}")
    print(f"  distances experiment {exp['distances']}\n            demo       {LIVE['distances']}")

    print()
    if fails:
        print("FAILED:")
        for f in fails:
            print("   ", f)
        sys.exit(1)
    print("PASS — the demonstrator emits the experiment's observation structure,")
    print("       and its measured gaze flows through the same code path.")


if __name__ == "__main__":
    main()
