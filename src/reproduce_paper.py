"""Recompute every table and statistic in the paper from the released files.

Reads only `output/*.csv` and `annotation/*.csv`; no model is called and the
corpus itself is not needed.

    python src/reproduce_paper.py

p-values are exact McNemar (paired binary outcomes), Mann-Whitney U (unpaired
quality scores), exact binomial against 50% chance, and Kruskal-Wallis, each
printed exactly and as the threshold the paper reports.
"""
from __future__ import annotations

import csv
import itertools
from collections import Counter, defaultdict
from statistics import mean, stdev

from scipy.stats import binomtest, kruskal, mannwhitneyu, spearmanr

import paths

OUT, ANN = paths.OUTPUT, paths.ANNOTATION
MODELS = {"agent_backend_1": "qwen3.6", "agent_backend_2": "mistral-small3.2",
          "agent_backend_3": "nemotron3"}
CONDS = ["P0", "P1a", "P1b", "P2a", "P2b"]
GROUPS = {"none": {"P0"}, "speaker": {"P1a", "P1b"}, "both": {"P2a", "P2b"}}


# ------------------------------------------------------------------ helpers

def rows(name):
    with open(OUT / name, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def pct(k, n):
    return 100 * k / n if n else float("nan")


def thr(p):
    if p < 0.001:
        return "p<0.001"
    if p < 0.01:
        return "p<0.01"
    if p < 0.05:
        return "p<0.05"
    return "p>0.05"


def mcnemar(b, c):
    """Exact two-sided McNemar on b (only first true) and c (only second true)."""
    return binomtest(min(b, c), b + c, 0.5).pvalue if b + c else 1.0


def paired(a, b, flag):
    """Discordant counts over keys present in both dicts: (a only, b only)."""
    keys = [k for k in a if k in b]
    return (sum(1 for k in keys if flag(a[k]) and not flag(b[k])),
            sum(1 for k in keys if flag(b[k]) and not flag(a[k])))


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    adj, run = [0.0] * len(ps), 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (len(ps) - rank) * ps[i]))
        adj[i] = run
    return adj


def header(title):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


# ------------------------------------------------------------------ Table I

def table_1(exp1):
    header("Table I - LookAway at a glance")
    turns = [r for r in exp1["agent_backend_1"] if r["condition"] == "P0"]
    clear = [r for r in turns if r["tier"] != "trap"]
    traps = [r for r in turns if r["tier"] == "trap"]
    print(f"sessions (two people each)          {len({r['pair_id'] for r in turns})}")
    print(f"turns                               {len(turns):,}")
    print(f"  clearly to the agent              {sum(r['expected_behavior'] == 'respond' for r in clear)}")
    print(f"  clearly to the other person       {sum(r['expected_behavior'] == 'abstain' for r in clear)}")
    print(f"  traps                             {len(traps)}")
    print(f"    congruent / incongruent         {sum(r['gaze_congruent'] == 'True' for r in traps)} / "
          f"{sum(r['gaze_congruent'] == 'False' for r in traps)}")
    print(f"questions about the other person    {sum(r['content_type'] == 'cross_reference' for r in turns)}")
    print(f"conditions                          {len({r['condition'] for r in exp1['agent_backend_1']})}")
    print(f"decisions per agent                 {len(exp1['agent_backend_1']):,}")
    print(f"decisions overall (3 agents)        {sum(len(v) for v in exp1.values()):,}, "
          f"parse failures {sum(r['parse_failed'] == 'True' for v in exp1.values() for r in v)}")


# ------------------------------------------------------------------ Experiment 1

def exp1_section(exp1):
    header("Section IV-A - clear turns (240 to the agent, 640 to the other person)")
    for bk, name in MODELS.items():
        acc, false_resp, recall = [], [], []
        for c in CONDS:
            rs = [r for r in exp1[bk] if r["condition"] == c and r["tier"] != "trap"]
            other = [r for r in rs if r["expected_behavior"] == "abstain"]
            agent = [r for r in rs if r["expected_behavior"] == "respond"]
            acc.append(pct(sum(r["correct"] == "True" for r in rs), len(rs)))
            false_resp.append(pct(sum(r["responded"] == "True" for r in other), len(other)))
            recall.append(pct(sum(r["responded"] == "True" for r in agent), len(agent)))
        print(f"{name:<17} accuracy  " + "  ".join(f"{c} {a:5.1f}" for c, a in zip(CONDS, acc)))
        print(f"{'':<17} answers turns meant for the other person  "
              + "  ".join(f"{c} {a:4.1f}" for c, a in zip(CONDS, false_resp)))
        print(f"{'':<17} answers turns meant for the agent        "
              + "  ".join(f"{c} {a:5.1f}" for c, a in zip(CONDS, recall)))

    header("Table II - effect of adding spatial information (accuracy %, without -> with)")

    def stats(bk, c):
        rs = [r for r in exp1[bk] if r["condition"] == c]
        con = [r for r in rs if r["tier"] == "trap" and r["gaze_congruent"] == "True"]
        inc = [r for r in rs if r["tier"] == "trap" and r["gaze_congruent"] == "False"]
        resp = [r for r in rs if r["responded"] == "True"]
        tp = sum(r["expected_behavior"] == "respond" for r in resp)
        gold = sum(r["expected_behavior"] == "respond" for r in rs)
        return {"con": pct(sum(r["correct"] == "True" for r in con), len(con)),
                "inc": pct(sum(r["correct"] == "True" for r in inc), len(inc)),
                "follows": pct(sum(r["signal_followed"] == "gaze" for r in inc), len(inc)),
                "prec": pct(tp, len(resp)), "rec": pct(tp, gold)}

    print(f"{'':<17}{'':<4}{'congruent':>16}{'incongruent':>16}{'follows cue':>13}"
          f"{'precision':>16}{'recall':>16}")
    for bk in ("agent_backend_1", "agent_backend_2"):
        s = stats(bk, "P0")
        print(f"{MODELS[bk]:<17}{'P0':<4}{s['con']:>16.1f}{s['inc']:>16.1f}{'---':>13}"
              f"{s['prec']:>16.1f}{s['rec']:>16.1f}")
        for label, a, b in (("P1", "P1a", "P1b"), ("P2", "P2a", "P2b")):
            x, y = stats(bk, a), stats(bk, b)
            arrow = lambda k: f"{x[k]:5.1f} -> {y[k]:5.1f}"
            print(f"{'':<17}{label:<4}{arrow('con'):>16}{arrow('inc'):>16}{y['follows']:>13.1f}"
                  f"{arrow('prec'):>16}{arrow('rec'):>16}")

    header("Section IV - exact McNemar on the eight spatial comparisons (paired traps)")
    ps, labels = [], []
    for bk in ("agent_backend_1", "agent_backend_2"):
        idx = {(r["pair_id"], r["turn_id"], r["condition"]): r for r in exp1[bk]}
        for a, b in (("P1a", "P1b"), ("P2a", "P2b")):
            for cong, lab in (("True", "congruent"), ("False", "incongruent")):
                ka = {(r["pair_id"], r["turn_id"]): r for r in exp1[bk] if r["condition"] == a
                      and r["tier"] == "trap" and r["gaze_congruent"] == cong}
                kb = {k: idx[k + (b,)] for k in ka}
                lost, gained = paired(ka, kb, lambda r: r["correct"] == "True")
                p = mcnemar(lost, gained)
                ps.append(p)
                labels.append(f"{MODELS[bk]:<17}{a}->{b} {lab:<12} correct->wrong {lost:>3}"
                              f"   wrong->correct {gained:>3}   p={p:.1e}")
    for lab, p, adj in zip(labels, ps, holm(ps)):
        print(f"{lab}   Holm {adj:.1e} ({thr(adj)})")

    header("Table III - warning qwen3.6 that orientation may be misleading (P1b)")
    abl = rows("ablation_gaze_prompt.csv")
    print(f"{'prompt':<14}{'congruent':>11}{'incongruent':>13}{'follows cue':>13}")
    for arm in ("baseline", "warned", "adversarial"):
        rs = [r for r in abl if r["arm"] == arm]
        con = [r for r in rs if r["gaze_congruent"] == "True"]
        inc = [r for r in rs if r["gaze_congruent"] == "False"]
        print(f"{arm:<14}{pct(sum(r['correct'] == 'True' for r in con), len(con)):>11.1f}"
              f"{pct(sum(r['correct'] == 'True' for r in inc), len(inc)):>13.1f}"
              f"{pct(sum(r['signal_followed'] == 'gaze' for r in inc), len(inc)):>13.1f}"
              f"   (n={len(con)}/{len(inc)})")


# ------------------------------------------------------------------ Experiment 2

def exp2_section():
    header("Section V - replies the extractor could not score")
    total = 0
    for bk, name in list(MODELS.items())[:2]:
        n_all = len(rows(f"exp2_backend{bk[-1]}.csv"))
        n_sc = len(rows(f"scored_backend{bk[-1]}.csv"))
        total += n_all - n_sc
        print(f"{name:<17} {n_all - n_sc} of {n_all:,} ({pct(n_all - n_sc, n_all):.1f}%)")
    print(f"{'total':<17} {total}")

    right = lambda r: int(r["n_about_referent"] or 0) > 0
    wrong = lambda r: r["referent_substituted"] == "True"
    disc = lambda r: r["over_disclosure"] == "True"
    mixups = lambda r: int(r["n_contam_revealed"] or 0) + int(r["n_contam_latent"] or 0)

    for bk, name in list(MODELS.items())[:2]:
        full = rows(f"exp2_backend{bk[-1]}.csv")
        sc = {(r["pair_id"], r["turn_id"], r["condition"]): r
              for r in rows(f"scored_backend{bk[-1]}.csv")}
        xr = [r for r in sc.values() if r["content_type"] == "cross_reference"]
        lat = [r for r in xr if r["attribute_targeted"] == "latent"]

        header(f"Table IV - responses about the other person ({name})")
        print(f"{'profiles held':<15}{'right person':>14}{'wrong person':>14}{'disclosure':>12}{'quality':>9}")
        for g, conds in GROUPS.items():
            x = [r for r in xr if r["condition"] in conds]
            l = [r for r in lat if r["condition"] in conds]
            q = [float(r["judge_score"]) for r in sc.values()
                 if r["condition"] in conds and r["judge_score"]]
            print(f"{g:<15}{pct(sum(map(right, x)), len(x)):>13.1f}%{pct(sum(map(wrong, x)), len(x)):>13.1f}%"
                  f"{pct(sum(map(disc, l)), len(l)):>11.1f}%{mean(q):>9.2f}"
                  f"   (n={len(x)} questions, {len(l)} latent, {len(q)} rated)")

        print("\nWorst case: every missing reply counted against the finding")
        full_x = [r for r in full if r["content_type"] == "cross_reference"]
        for lab, flag, base in (("right person", right, "all"), ("wrong person", wrong, "all"),
                                ("disclosure", disc, "latent")):
            parts = []
            for g, conds in GROUPS.items():
                tot = [r for r in full_x if r["condition"] in conds
                       and (base == "all" or r["attribute_targeted"] == "latent")]
                got = [sc[k] for r in tot if (k := (r["pair_id"], r["turn_id"], r["condition"])) in sc]
                k, miss = sum(map(flag, got)), len(tot) - len(got)
                parts.append(f"{g} {pct(k, len(tot)):4.1f}-{pct(k + miss, len(tot)):4.1f}%")
            print(f"  {lab:<13} " + "   ".join(parts))

        print("\nIdentity separation")
        solo = [r for r in sc.values() if r["content_type"] == "solo"]
        mixed = [r for r in xr if mixups(r)]
        print(f"  replies about the speaker: {len(solo)}, other person's facts attributed "
              f"to the speaker: {sum(map(mixups, solo))}")
        print(f"  mix-ups on questions about the other person: {sum(map(mixups, mixed))} "
              f"attributes in {len(mixed)} replies, conditions {sorted({r['condition'] for r in mixed})}")

        print("\nExact McNemar, one profile -> both profiles (paired questions)")
        for a, b in (("P1a", "P2a"), ("P1b", "P2b")):
            A = {k[:2]: r for k, r in sc.items() if k[2] == a and r in lat}
            B = {k[:2]: r for k, r in sc.items() if k[2] == b and r in lat}
            lost, new = paired(A, B, disc)
            print(f"  disclosure {a}->{b}: new {new}, reverse {lost}   "
                  f"p={mcnemar(lost, new):.1e} ({thr(mcnemar(lost, new))})")
        for lab, flag in (("right person", right), ("wrong person", wrong)):
            gained = lost = 0
            for a, b in (("P1a", "P2a"), ("P1b", "P2b")):
                A = {k[:2]: r for k, r in sc.items() if k[2] == a and r in xr}
                B = {k[:2]: r for k, r in sc.items() if k[2] == b and r in xr}
                l, g = paired(A, B, flag)
                lost, gained = lost + l, gained + g
            print(f"  {lab} P1->P2: gained {gained}, lost {lost}   "
                  f"p={mcnemar(lost, gained):.1e} ({thr(mcnemar(lost, gained))})")

        print("\nResponse quality (every third reply, all agent-addressed turns)")
        q = lambda cs: [float(r["judge_score"]) for r in sc.values()
                        if r["condition"] in cs and r["judge_score"]]
        q0, q2 = q({"P0"}), q({"P2a", "P2b"})
        u = mannwhitneyu(q2, q0, alternative="two-sided")
        r_rb = abs(1 - 2 * u.statistic / (len(q0) * len(q2)))
        print(f"  none {mean(q0):.2f} (SD={stdev(q0):.2f}) -> both {mean(q2):.2f} (SD={stdev(q2):.2f})"
              f"   Mann-Whitney p={u.pvalue:.1e} ({thr(u.pvalue)}), rank-biserial r={r_rb:.2f}")

        print("\nEffect of the spatial line on response content (Section V-F)")
        for a, b in (("P1a", "P1b"), ("P2a", "P2b")):
            for lab, flag in (("right person", right), ("wrong person", wrong), ("disclosure", disc)):
                pool = xr
                A = {k[:2]: r for k, r in sc.items() if k[2] == a and r in pool}
                B = {k[:2]: r for k, r in sc.items() if k[2] == b and r in pool}
                keys = [k for k in A if k in B]
                l, g = paired(A, B, flag)
                print(f"  {a}->{b} {lab:<13} {pct(sum(flag(A[k]) for k in keys), len(keys)):5.1f} -> "
                      f"{pct(sum(flag(B[k]) for k in keys), len(keys)):5.1f}%   "
                      f"p={mcnemar(l, g):.3f} ({thr(mcnemar(l, g))})")
            qa, qb = q({a}), q({b})
            p = mannwhitneyu(qa, qb, alternative="two-sided").pvalue
            print(f"  {a}->{b} quality       {mean(qa):5.2f} -> {mean(qb):5.2f}    p={p:.3f} ({thr(p)})")


def privacy_section():
    for fn, title, n_note in (
        ("ablation_privacy_prompt.csv", "questions about an attribute never said aloud", "latent"),
        ("ablation_privacy_public.csv", "questions about an attribute already said aloud", "revealed"),
    ):
        header(f"Section V - privacy instruction, qwen3.6 P2b: {title}")
        by = defaultdict(dict)
        for r in rows(fn):
            by[r["arm"]][(r["pair_id"], r["turn_id"])] = r
        disc = lambda r: r["over_disclosure"] == "True"
        ans = lambda r: r["hit_referent"] == "True"
        for arm in ("baseline", "privacy", "strict"):
            rs = list(by[arm].values())
            print(f"  {arm:<9} n={len(rs):>2}   discloses {pct(sum(map(disc, rs)), len(rs)):5.1f}%"
                  f"   answers about the other person {pct(sum(map(ans, rs)), len(rs)):5.1f}%")
        for arm in ("privacy", "strict"):
            for lab, flag in (("disclosure", disc), ("answers", ans)):
                stopped, started = paired(by["baseline"], by[arm], flag)
                p = mcnemar(stopped, started)
                n = sum(1 for k in by[arm] if k in by["baseline"])
                print(f"  baseline->{arm:<8} {lab:<11} stopped {stopped:>2}, started {started:>2}"
                      f"  (n={n})  p={p:.1e} ({thr(p)})")


# ------------------------------------------------------------------ Section VI

def fleiss(table):
    n = len(table[0])
    cats = sorted({v for row in table for v in row})
    N = len(table)
    pj = {c: sum(row.count(c) for row in table) / (N * n) for c in cats}
    pbar = sum((sum(row.count(c) ** 2 for c in cats) - n) / (n * (n - 1)) for row in table) / N
    pe = sum(v * v for v in pj.values())
    return (pbar - pe) / (1 - pe)


def validation_section():
    header("Section VI - human validation (four annotators, A1-A4)")
    with open(ANN / "answer_key.csv", encoding="utf-8") as f:
        key = {r["item_id"]: r for r in csv.DictReader(f)}
    ann = {}
    for a in ("A1", "A2", "A3", "A4"):
        with open(ANN / f"annotations_{a}.csv", encoding="utf-8") as f:
            ann[a] = {r["item_id"]: (r.get("your_answer") or "").strip().strip('"').lower()
                      for r in csv.DictReader(f)}
    ids = lambda p: sorted(i for i in key if i.startswith(p))
    kappa = lambda items: fleiss([[ann[a][i] for a in ann] for i in items])

    for task, prefix in (("text-only traps (Task B)", "B"), ("traps with the spatial line (Task A)", "A")):
        items = ids(prefix)
        dec = [(i, ann[a][i]) for a in ann for i in items if ann[a][i] in ("assistant", "other person")]
        right = sum(v == key[i]["truth"].lower() for i, v in dec)
        p = binomtest(right, len(dec), 0.5).pvalue
        print(f"{task:<40} n={len(items)}  accuracy {right}/{len(dec)} = {pct(right, len(dec)):.1f}%"
              f"  vs 50%: p={p:.1e} ({thr(p)})  Fleiss kappa={kappa(items):.3f}")

    for task, prefix, field in (("authored contrasts (Task D)", "D", "intended"),
                                ("extractor (Task E)", "E", "machine_said")):
        items = ids(prefix)
        agree = sum(ann[a][i] == (key[i][field] or "").lower() for a in ann for i in items)
        total = len(items) * len(ann)
        print(f"{task:<40} n={len(items)}  agreement with key {agree}/{total} = {pct(agree, total):.1f}%"
              f"  Fleiss kappa={kappa(items):.3f}")

    items = ids("C")
    code = {"wrong person": 0, "not from list": 1, "uses list": 2}
    groups, xs, ys = defaultdict(list), [], []
    for i in items:
        label, votes = Counter(ann[a][i] for a in ann).most_common(1)[0]
        if votes >= 3 and key[i]["llm_judge_score"]:
            score = float(key[i]["llm_judge_score"])
            groups[label].append(score)
            xs.append(code[label])
            ys.append(score)
    h = kruskal(*groups.values())
    s = spearmanr(xs, ys)
    print(f"{'profile use vs judge quality (Task C)':<40} n={len(items)}  Fleiss kappa={kappa(items):.3f}")
    print(f"{'':<40} {len(xs)} items with a 3-of-4 majority: Kruskal-Wallis H={h.statistic:.2f},"
          f" p={h.pvalue:.4f} ({thr(h.pvalue)}); Spearman rho={s.statistic:.3f}, p={s.pvalue:.4f}")


def have(*names):
    return all((OUT / n).exists() for n in names)


def main():
    exp1_files = [f"exp1_backend{bk[-1]}.csv" for bk in MODELS]
    if have(*exp1_files, "ablation_gaze_prompt.csv"):
        exp1 = {bk: rows(f"exp1_backend{bk[-1]}.csv") for bk in MODELS}
        table_1(exp1)
        exp1_section(exp1)
    else:
        header("Tables I-III - waiting for output/exp1_*.csv (released upon acceptance)")
    if have("exp2_backend1.csv", "exp2_backend2.csv", "scored_backend1.csv", "scored_backend2.csv"):
        exp2_section()
    else:
        header("Table IV and Section V - waiting for output/exp2_*.csv and scored_*.csv "
               "(released upon acceptance)")
    if have("ablation_privacy_prompt.csv", "ablation_privacy_public.csv"):
        privacy_section()
    else:
        header("Privacy instruction - waiting for output/ablation_privacy_*.csv "
               "(released upon acceptance)")
    validation_section()


if __name__ == "__main__":
    main()
