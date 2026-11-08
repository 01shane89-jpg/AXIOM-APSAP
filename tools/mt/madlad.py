"""Machine translation to English with Google's MADLAD-400 (3B MT model, Apache-2.0), run on the job's own CPU.

Reads {"items": [{"text": ..., "lang": ...}]} as JSON on stdin and writes {"out": [english or null, ...]} on stdout, and with
MT_SCORES=1 also "scores": [the model's confidence, or null, ...]: CTranslate2's score (log-probability, length-normalized by its
default length penalty) of the item's least confident chunk, 0 being certain, and "raw": the same divided by the chunk's
output token count, for comparison.
The model is converted once to CTranslate2 int8 by tools/mt/setup_madlad.py and kept in the Actions cache (MT_DIR).
No network use at translation time. MADLAD-400 needs no source language: each text is prefixed with "<2en>".
This file is the only place that knows the model, so another one can replace it behind the same stdin/stdout contract.
Untrusted text is only ever data here: it is tokenised and translated, never interpreted.
"""
import json, os, re, sys, time

MODEL_DIR = os.environ.get("MT_DIR", os.path.expanduser("~/.cache/osap-mt/madlad400-3b-mt-ct2-int8"))
MAX_CHARS, CHUNK = 1200, 350

def chunks(text):
    text = re.sub(r"\s+", " ", text.strip())[:MAX_CHARS]
    parts, cur = [], ""
    for s in re.split(r"(?<=[.!?。！？။।])\s*", text):
        if not s: continue
        if len(cur) + len(s) > CHUNK and cur: parts.append(cur); cur = ""
        cur = (cur + " " + s).strip() if cur else s
        while len(cur) > CHUNK: parts.append(cur[:CHUNK]); cur = cur[CHUNK:]
    if cur: parts.append(cur)
    return parts

def main():
    items = json.load(sys.stdin).get("items", [])
    import ctranslate2, sentencepiece as spm
    sp = spm.SentencePieceProcessor(model_file=os.path.join(MODEL_DIR, "spiece.model"))
    tr = ctranslate2.Translator(MODEL_DIR, device="cpu", compute_type="int8", inter_threads=1, intra_threads=os.cpu_count() or 2)
    jobs = []
    for i, it in enumerate(items):
        if not (it.get("text") or "").strip(): continue
        for c in chunks(it["text"]): jobs.append((i, sp.encode("<2en> " + c, out_type=str) + ["</s>"]))
    # Translate in slices and stop at the time budget (MT_BUDGET seconds), so a long queue returns what is done
    # instead of being killed with nothing; the caller orders the queue by priority and the rest waits for the next run.
    budget, t0, res = float(os.environ.get("MT_BUDGET", "300")), time.time(), []
    scores_on = os.environ.get("MT_SCORES") == "1"
    # The penalty and the no-repeat rule stop the greedy decoder looping ("single-track, single-track, ..."), which it did on
    # short Thai headlines.
    # MT_BEAM, MT_REP_PENALTY and MT_NO_REPEAT override them (tools/mt/probe_settings.mjs compares settings).
    beam, pen, norep = int(os.environ.get("MT_BEAM", "1")), float(os.environ.get("MT_REP_PENALTY", "1.2")), int(os.environ.get("MT_NO_REPEAT", "4"))
    for k in range(0, len(jobs), 32):
        if res and time.time() - t0 > budget: break
        res += tr.translate_batch([j[1] for j in jobs[k:k + 32]], beam_size=beam, max_batch_size=16, max_decoding_length=256,
                                repetition_penalty=pen, no_repeat_ngram_size=norep,
                                **({"return_scores": True} if scores_on else {}))
    done = set(i for (i, _), _r in zip(jobs, res))
    out, sc, pt = [None] * len(items), [None] * len(items), [None] * len(items)
    for (i, _), r in zip(jobs, res):
        en = sp.decode(r.hypotheses[0]).strip()
        if en: out[i] = (out[i] + " " + en).strip() if out[i] else en
        if scores_on and r.scores:
            v, w = r.scores[0], r.scores[0] / max(1, len(r.hypotheses[0]))
            sc[i] = v if sc[i] is None else min(sc[i], v)
            pt[i] = w if pt[i] is None else min(pt[i], w)
    # an item whose chunks were only partly translated is left for the next run
    for i in done:
        if any(j[0] == i for j in jobs[len(res):]): out[i] = sc[i] = pt[i] = None
    json.dump({"out": out, **({"scores": sc, "raw": pt} if scores_on else {})}, sys.stdout, ensure_ascii=False)

if __name__ == "__main__":
    main()
