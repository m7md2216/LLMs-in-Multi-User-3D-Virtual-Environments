"""Filesystem locations, relative to the repository root.

No module hardcodes an absolute path, so the project runs unchanged from any
directory on any OS.
"""
from __future__ import annotations

from pathlib import Path

SRC = Path(__file__).resolve().parent
ROOT = SRC.parent
DATA = ROOT / "data"
OUTPUT = ROOT / "output"
ANNOTATION = ROOT / "annotation"

for _d in (DATA, OUTPUT):
    _d.mkdir(parents=True, exist_ok=True)

PERSONAS_FINAL = DATA / "personas_final.json"
