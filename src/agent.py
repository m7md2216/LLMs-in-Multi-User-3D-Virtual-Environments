"""Step 4 — the agent under test.

Two-stage by design (section 8): classify first in a separate call, generate
second. A single call that writes a reply has already committed to responding
and will rationalise it, so abstention would be under-measured.

Prompt bodies come from `state_machine.render`, which is the frozen definition of
what each condition sees. Nothing here decides what a condition exposes.

Per-backend prompt overrides live in `prompts/<backend>.yaml` and are reported in
the paper as the per-model tuning that section 10 requires be disclosed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

import llm
from state_machine import Condition, Session, Turn

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"

# Section 8 verbatim. Abstention must be the default or precision collapses.
CLASSIFY_SYSTEM = """You are an assistant in a room with two people who are talking to each other
and occasionally to you. Most utterances are NOT for you. Only respond when
someone is addressing you directly. If two people are talking to each other,
stay silent."""

CLASSIFY_TASK = """Based on the conversation above, is the FINAL line (turn {turn}) addressed to
you, the assistant?

Answer with JSON only: {{"respond": true}} if it is addressed to you, or
{{"respond": false}} if the two people are talking to each other."""

GENERATE_SYSTEM = """You are a helpful assistant in a room with two people. Answer the person who
just addressed you, briefly and naturally — two or three sentences. Speak to
them directly. Do not narrate, do not describe yourself, do not use their name
more than once."""

GENERATE_TASK = """Turn {turn} is addressed to you. Write your reply."""


@dataclass
class Decision:
    responded: bool
    raw: str
    parse_failed: bool = False


def _overrides(backend: str) -> dict:
    """Per-backend prompt tuning, kept out of the core templates."""
    f = PROMPTS / f"{backend}.yaml"
    if not f.exists():
        return {}
    return yaml.safe_load(f.read_text()) or {}


def classify(session: Session, turn_index: int, condition: Condition,
             backend: str) -> Decision:
    """Stage 1. Returns respond/abstain for the turn at `turn_index` (1-based)."""
    ov = _overrides(backend)
    body = session.render(condition, upto=turn_index, experiment=1)
    system = ov.get("classify_system", CLASSIFY_SYSTEM)
    task = ov.get("classify_task", CLASSIFY_TASK).format(turn=turn_index)

    try:
        r = llm.call_json(
            backend,
            [{"role": "system", "content": system},
             {"role": "user", "content": f"{body}\n\n{task}"}],
            schema_hint='{"respond": true}',
            max_tokens=ov.get("classify_max_tokens", 40),
        )
        val = r.get("respond")
        if isinstance(val, str):
            val = val.strip().lower() in ("true", "yes", "1")
        return Decision(bool(val), raw=str(r))
    except llm.ProviderError as e:
        # A backend that cannot emit the format is a reported result, not a
        # silent abstention — section 10 requires per-backend parse-failure rates.
        return Decision(False, raw=str(e)[:200], parse_failed=True)


def generate(session: Session, turn_index: int, condition: Condition,
             backend: str) -> str:
    """Stage 2. Only called where a response is wanted."""
    ov = _overrides(backend)
    body = session.render(condition, upto=turn_index, experiment=2)
    system = ov.get("generate_system", GENERATE_SYSTEM)
    task = ov.get("generate_task", GENERATE_TASK).format(turn=turn_index)
    out = llm.call(
        backend,
        [{"role": "system", "content": system},
         {"role": "user", "content": f"{body}\n\n{task}"}],
        max_tokens=ov.get("generate_max_tokens", 200),
    )
    return _clean(out)


def _clean(text: str) -> str:
    t = (text or "").strip()
    t = re.sub(r"^```.*?\n|\n```$", "", t, flags=re.S).strip()
    t = re.sub(r"^\s*(assistant|ai)\s*:\s*", "", t, flags=re.I)
    if len(t) >= 2 and t[0] == t[-1] == '"':
        t = t[1:-1].strip()
    return " ".join(t.split())


def run_exp2_turn(session: Session, turn: Turn, condition: Condition, backend: str):
    """Experiment 2 row: a FORCED response at a designated agent-directed turn.

    Generation here does NOT depend on the Experiment 1 classification. Section 9
    prompts for a response at designated turns regardless of what the classifier
    decided; conditioning on it would give lower-response-rate conditions fewer
    scored responses and bias the personalization comparison toward whichever
    condition happened to answer more often.
    """
    return {
        "pair_id": session.pair_id,
        "turn_id": turn.turn,
        "condition": condition,
        "backend": backend,
        "scenario": session.scenario,
        "content_type": turn.content_type,
        "referent": turn.referent,
        "attribute_targeted": turn.attribute_targeted,
        "reference_style": turn.reference_style,
        "addressee_name": (session.speakers[turn.speaker].name),
        "referent_name": (session.speakers[turn.referent].name if turn.referent else ""),
        "over_disclosure_eligible": turn.over_disclosure_eligible(),
        "utterance": turn.utterance,
        "response_text": generate(session, turn.turn, condition, backend),
    }


def run_turn(session: Session, turn: Turn, condition: Condition, backend: str):
    """One results row's worth of agent behaviour.

    `signal_followed` is derived, never asked for — and is NULL outside the
    spatial conditions, where the model never saw a gaze channel to follow.
    """
    d = classify(session, turn.turn, condition, backend)
    response = generate(session, turn.turn, condition, backend) if d.responded else ""
    spatial = condition in ("P1b", "P2b")
    return {
        "pair_id": session.pair_id,
        "turn_id": turn.turn,
        "condition": condition,
        "backend": backend,
        "scenario": session.scenario,
        "tier": turn.tier,
        "expected_behavior": turn.expected,
        "addressee": turn.addressee,
        "content_type": turn.content_type,
        "referent": turn.referent,
        "attribute_targeted": turn.attribute_targeted,
        "reference_style": turn.reference_style,
        "gaze_congruent": turn.gaze_congruent,
        "signal_followed": (turn.signal_followed(d.responded) if spatial else None),
        "responded": d.responded,
        "response_text": response,
        "correct": d.responded == (turn.expected == "respond"),
        "parse_failed": d.parse_failed,
    }
