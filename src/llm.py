"""Single adapter interface for every model call in the project.

No experiment code may import a provider SDK. Everything goes through `call()`,
so adding a closed model later is a models.yaml edit plus one adapter class.

Guarantees:
  * cache keyed on (prompt_hash, model_id, revision, temperature) — adding a
    model never invalidates existing cached results
  * per-call cost and token accounting, logged from the first call
  * JSON repair retry, max 2 attempts, with parse-failure rate tracked per model
  * provider-agnostic retry/backoff
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "models.yaml"
CACHE_DB = ROOT / "data" / "llm_cache.sqlite"


class ConfigError(RuntimeError):
    pass


class ProviderError(RuntimeError):
    """Transient by default — the retry loop will back off and try again."""


class FatalProviderError(ProviderError):
    """Deterministic. Retrying reproduces it exactly, so do not waste the time.

    Thinking-only responses and malformed requests are configuration errors, not
    flaky networks. An earlier version retried these four times with exponential
    backoff, turning a 2-second failure into a 15-second one on every call.
    """


@dataclass
class Usage:
    calls: int = 0
    cached: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    parse_failures: int = 0
    parse_attempts: int = 0
    latency_ms: list = field(default_factory=list)


class Registry:
    """Role -> model config, loaded from models.yaml."""

    def __init__(self, path=CONFIG):
        if not path.exists():
            raise ConfigError(f"missing {path}")
        self.cfg = yaml.safe_load(path.read_text())
        self.roles = self.cfg["roles"]
        self.defaults = self.cfg.get("defaults", {})
        self.caps = self.cfg.get("capabilities", {}).get(self.cfg["provider"], {})

    def resolve(self, role_or_id):
        if role_or_id in self.roles:
            m = dict(self.roles[role_or_id], role=role_or_id)
        else:
            m = None
            for r, c in self.roles.items():
                if c["id"] == role_or_id:
                    m = dict(c, role=r)
                    break
            if m is None:
                m = {"id": role_or_id, "role": role_or_id, "price": {"in": 0, "out": 0}}
        m.setdefault("provider", self.cfg.get("provider", "ollama"))
        return m

    def provider_cfg(self, name):
        return self.cfg.get("providers", {}).get(name, {})

    def caps_for(self, name):
        return self.cfg.get("capabilities", {}).get(name, {})

    def api_key(self, provider):
        env = self.provider_cfg(provider).get("api_key_env")
        if not env:
            return None                       # local provider, no auth
        key = os.environ.get(env)
        if not key:
            raise ConfigError(
                f"${env} is not set, required by provider '{provider}'. Set it in "
                f"your shell environment; never paste it into source or chat."
            )
        return key


class Cache:
    """Prompt cache, safe to share across threads.

    A sqlite3 connection belongs to the thread that opened it and raises if used
    from another. The batch scripts are single-threaded so one connection was
    enough, but the demonstrator answers turns on a worker thread, where the
    second turn lands on a different worker and the call fails outright. Each
    thread therefore gets its own connection to the same file; WAL lets them
    read while one writes. Lookup and contents are unchanged, so nothing that
    was computed with the old version would come out differently.
    """

    def __init__(self, path=CACHE_DB):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = str(path)
        self._local = threading.local()
        db = self.db                       # opens for this thread + makes schema
        db.execute(
            "CREATE TABLE IF NOT EXISTS cache ("
            " k TEXT PRIMARY KEY, text TEXT, prompt_tokens INT,"
            " completion_tokens INT, model TEXT, ts REAL)")
        db.commit()

    @property
    def db(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            # timeout covers the moment another thread holds the write lock
            conn = sqlite3.connect(self._path, timeout=30.0)
            try:
                conn.execute("PRAGMA journal_mode=WAL")
            except sqlite3.DatabaseError:
                pass                        # older file, or a read-only mount
            self._local.conn = conn
        return conn

    @staticmethod
    def key(messages, model_id, temperature, extra=""):
        blob = json.dumps(messages, sort_keys=True, ensure_ascii=False)
        h = hashlib.sha256(blob.encode()).hexdigest()
        return f"{h}|{model_id}|{temperature}|{extra}"

    def get(self, k):
        row = self.db.execute(
            "SELECT text, prompt_tokens, completion_tokens FROM cache WHERE k=?",
            (k,)).fetchone()
        return row

    def put(self, k, text, pt, ct, model):
        self.db.execute(
            "INSERT OR REPLACE INTO cache VALUES (?,?,?,?,?,?)",
            (k, text, pt, ct, model, time.time()))
        self.db.commit()


class _Adapter:
    """One adapter per provider INSTANCE, not per kind.

    Several instances can share a kind — `local_gpu` and `local_mac` are both
    `ollama` but differ in base_url, timeout, and capabilities.
    """
    kind = ""

    def __init__(self, registry: Registry, instance: str):
        self.reg = registry
        self.name = instance
        self.cfg = registry.provider_cfg(instance)
        self.caps = registry.caps_for(instance)
        self.base = self.cfg.get("base_url", "").rstrip("/")

    def _post(self, path, body, headers=None):
        req = urllib.request.Request(
            f"{self.base}{path}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        timeout = self.cfg.get("timeout_s", self.reg.defaults.get("timeout_s", 120))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            # The provider's own message lives in the error body. Without this,
            # every 4xx surfaces as a bare "HTTP Error 400: Bad Request".
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                detail = "(no body)"
            raise ProviderError(f"HTTP {e.code} from {self.base}{path}: {detail}") from e


class OpenRouterAdapter(_Adapter):
    kind = "openrouter"

    def complete(self, model_id, messages, temperature, max_tokens, json_mode,
                 seed, think=None):
        body = {"model": model_id, "messages": messages, "temperature": temperature}
        if max_tokens:
            body["max_tokens"] = max_tokens
        if json_mode and self.caps.get("json_mode"):
            body["response_format"] = {"type": "json_object"}
        if seed is not None and self.caps.get("seed"):
            body["seed"] = seed

        payload = self._post(
            "/chat/completions", body,
            {"Authorization": f"Bearer {self.reg.api_key(self.name)}"})
        if "choices" not in payload:
            raise ProviderError(str(payload)[:400])
        u = payload.get("usage", {})
        return (payload["choices"][0]["message"]["content"] or "",
                u.get("prompt_tokens", 0), u.get("completion_tokens", 0))


class OllamaAdapter(_Adapter):
    """Local inference. Same interface, no auth, no cost.

    `base_url` may point at localhost or at another machine on the LAN, so the
    GPU box can serve while the project runs elsewhere — a config edit, not a
    code change.
    """
    kind = "ollama"

    def complete(self, model_id, messages, temperature, max_tokens, json_mode,
                 seed, think=None):
        # Ollama defaults to a 4096-token context and SILENTLY TRUNCATES beyond
        # it — no error, no warning. A truncated prompt would drop the start of
        # a transcript and still return a plausible-looking answer, so num_ctx is
        # always set explicitly and the result is checked below.
        num_ctx = self.cfg.get("num_ctx", 8192)
        options = {"temperature": temperature, "num_ctx": num_ctx}
        if max_tokens:
            options["num_predict"] = max_tokens
        if seed is not None:
            options["seed"] = seed          # local seeding is honoured properly
        body = {"model": model_id, "messages": messages,
                "stream": False, "options": options}
        if think is not None:
            body["think"] = bool(think)
        if json_mode:
            body["format"] = "json"

        payload = self._post("/api/chat", body)
        if "message" not in payload:
            raise ProviderError(str(payload)[:400])
        pt = payload.get("prompt_eval_count", 0)
        if pt and pt >= num_ctx - 8:
            raise ProviderError(
                f"prompt likely TRUNCATED: prompt_eval_count={pt} against "
                f"num_ctx={num_ctx} for {model_id}. Raise num_ctx for this "
                f"provider in models.yaml — do not let this pass silently.")

        msg = payload["message"]
        content = msg.get("content", "") or ""
        thinking = msg.get("thinking") or ""
        # Thinking models split the reply: reasoning goes to `thinking`, the
        # answer to `content`. If num_predict is exhausted by reasoning, content
        # comes back EMPTY while the call still looks successful — which would
        # have written 1,200 blank utterances and reported success. Never
        # silent.
        if not content.strip() and thinking.strip():
            raise FatalProviderError(
                f"{model_id} returned only reasoning, no content "
                f"({len(thinking)} chars of thinking, eval_count="
                f"{payload.get('eval_count')}). Either set `think: false` for "
                f"this role in models.yaml, or raise max_tokens so the answer "
                f"fits after the reasoning.")
        return content, pt, payload.get("eval_count", 0)


ADAPTERS = {a.kind: a for a in (OpenRouterAdapter, OllamaAdapter)}


_REG = None
_CACHE = None
_ADAPTERS: dict[str, object] = {}
USAGE: dict[str, Usage] = defaultdict(Usage)


def _boot():
    global _REG, _CACHE
    if _REG is None:
        _REG = Registry()
        _CACHE = Cache()
    return _REG, _CACHE


def _adapter_for(provider):
    if provider not in _ADAPTERS:
        cfg = _REG.provider_cfg(provider)
        if not cfg:
            raise ConfigError(f"provider '{provider}' is not declared in models.yaml")
        kind = cfg.get("kind", provider)
        if kind not in ADAPTERS:
            raise ConfigError(
                f"provider '{provider}' has kind '{kind}'; known kinds: "
                f"{sorted(ADAPTERS)}")
        _ADAPTERS[provider] = ADAPTERS[kind](_REG, provider)
    return _ADAPTERS[provider]


def call(role_or_id, messages, temperature=None, max_tokens=None,
         json_mode=False, seed=None, use_cache=True, think=None):
    """The single entry point. `role_or_id` is a models.yaml role or a raw id."""
    reg, cache = _boot()
    m = reg.resolve(role_or_id)
    adapter = _adapter_for(m["provider"])
    model_id = m["id"]
    temp = temperature if temperature is not None else m.get(
        "temperature", reg.defaults.get("temperature", 0.0))

    if think is None:
        think = m.get("think")
    k = Cache.key(messages, model_id, temp, f"{seed}|{think}")
    u = USAGE[m["role"]]

    if use_cache:
        hit = cache.get(k)
        if hit:
            u.calls += 1
            u.cached += 1
            return hit[0]

    delay, last = 1.0, None
    for attempt in range(reg.defaults.get("max_retries", 4)):
        try:
            t0 = time.time()
            text, pt, ct = adapter.complete(
                model_id, messages, temp, max_tokens, json_mode, seed, think)
            u.latency_ms.append(int((time.time() - t0) * 1000))
            u.calls += 1
            u.prompt_tokens += pt
            u.completion_tokens += ct
            price = m.get("price", {})
            u.cost_usd += (pt * price.get("in", 0) + ct * price.get("out", 0)) / 1e6
            if use_cache:
                cache.put(k, text, pt, ct, model_id)
            return text
        except FatalProviderError:
            raise                                   # deterministic; do not retry
        except (urllib.error.HTTPError, urllib.error.URLError, ProviderError, TimeoutError) as e:
            last = e
            code = getattr(e, "code", None)
            if code and code not in (408, 429, 500, 502, 503, 504):
                raise
            time.sleep(delay + random.random() * 0.3)
            delay *= 2
    raise ProviderError(f"{model_id} failed after retries: {last}")


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def call_json(role_or_id, messages, schema_hint=None, **kw):
    """Call and parse JSON, repairing once on failure. Max 2 attempts total."""
    reg, _ = _boot()
    u = USAGE[reg.resolve(role_or_id)["role"]]
    msgs = list(messages)

    for attempt in range(2):
        u.parse_attempts += 1
        raw = call(role_or_id, msgs, json_mode=True,
                   use_cache=kw.pop("use_cache", True) if attempt == 0 else False, **kw)
        candidate = raw.strip()
        fence = _FENCE.search(candidate)
        if fence:
            candidate = fence.group(1).strip()
        start = min([i for i in (candidate.find("{"), candidate.find("[")) if i >= 0],
                    default=-1)
        if start > 0:
            candidate = candidate[start:]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as e:
            u.parse_failures += 1
            if attempt == 1:
                raise ProviderError(f"unparseable JSON after repair: {raw[:300]}") from e
            msgs = messages + [
                {"role": "assistant", "content": raw[:2000]},
                {"role": "user", "content":
                 "That was not valid JSON. Return ONLY the JSON object, no prose, "
                 "no code fence." + (f" Schema: {schema_hint}" if schema_hint else "")},
            ]


def report():
    """Per-role usage, cost, and parse-failure rate — for the paper."""
    lines = [f"{'role':<20}{'calls':>7}{'cached':>8}{'in tok':>10}{'out tok':>9}"
             f"{'cost $':>9}{'parse fail':>12}"]
    total = 0.0
    for role, u in sorted(USAGE.items()):
        rate = f"{u.parse_failures}/{u.parse_attempts}" if u.parse_attempts else "-"
        lines.append(f"{role:<20}{u.calls:>7}{u.cached:>8}{u.prompt_tokens:>10}"
                     f"{u.completion_tokens:>9}{u.cost_usd:>9.4f}{rate:>12}")
        total += u.cost_usd
    lines.append(f"{'TOTAL':<20}{'':>34}{total:>9.4f}")
    return "\n".join(lines)
