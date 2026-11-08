"""Diagnostic, writes nothing to the app: compares OPUS-MT (Helsinki-NLP, CC-BY-4.0) with MADLAD-400 (the model the refresh job
uses) for the busiest news languages, to decide whether a per-language OPUS-MT model should translate those languages instead.

Two measures, per language:
  1. Accuracy against human translations: the first N sentences of NTREX-128 (Microsoft, CC-BY-SA-4.0; WMT19 news test set
     translated by professionals into 128 languages). Each model translates the foreign text to English and is scored with chrF++
     (sacrebleu) against the original English. NTREX is only read here; nothing from it is stored.
  2. Real OSAP headlines (tools/mt/probe_confidence_samples.json): both models' output is written to probe-out/mt-opus.json,
     where tools/mt/probe_opus_report.mjs runs tools/mt_guard.mjs on it and prints lines side by side.
Speed (sentences per second on the runner) is reported for both.

Run by the refresh workflow with only=probe-mt-opus. OPUS-MT models are converted to CTranslate2 int8 on the runner.
Untrusted text is only ever data here: it is tokenised and translated, never interpreted.
"""
import json, os, subprocess, sys, time, urllib.request

LANGS = os.environ.get("PROBE_LANGS", "ko,zh,ja,ar,fr,es,ru").split(",")
N = int(os.environ.get("PROBE_N", "100"))
NTREX = {"ko": "kor", "zh": "zho-CN", "ja": "jpn", "ar": "arb", "fr": "fra", "es": "spa", "ru": "rus", "de": "deu", "pt": "por",
         "vi": "vie", "th": "tha", "id": "ind", "tr": "tur", "fa": "fas", "uk": "ukr", "hi": "hin"}
RAW = "https://raw.githubusercontent.com/MicrosoftTranslator/NTREX/main/NTREX-128/"
WORK = os.environ.get("OPUS_DIR", "/mnt/opus")
MADLAD = os.environ.get("MT_DIR", os.path.expanduser("~/.cache/osap-mt/madlad400-3b-mt-ct2-int8"))


def fetch(name):
    with urllib.request.urlopen(RAW + name, timeout=60) as r:
        return r.read().decode("utf-8").splitlines()


def ntrex(code):
    try:
        return fetch("newstest2019-ref.%s.txt" % code)
    except Exception:
        # file names have varied between releases: look the language up in the folder listing
        req = urllib.request.Request("https://api.github.com/repos/MicrosoftTranslator/NTREX/contents/NTREX-128",
                                     headers={"User-Agent": "osap-probe"})
        names = [f["name"] for f in json.load(urllib.request.urlopen(req, timeout=60))]
        hit = [n for n in names if ".%s." % code in n or ".%s" % code.split("-")[0] in n]
        if not hit: raise
        return fetch(hit[0])


def opus_model(lang):
    """Convert the best available OPUS-MT model for lang->en; return (name, dir) or (None, None)."""
    for name in ("Helsinki-NLP/opus-mt-tc-big-%s-en" % lang, "Helsinki-NLP/opus-mt-%s-en" % lang):
        out = os.path.join(WORK, name.split("/")[1])
        if os.path.exists(os.path.join(out, "model.bin")): return name, out
        r = subprocess.run(["ct2-transformers-converter", "--model", name, "--output_dir", out, "--quantization", "int8", "--force"],
                           capture_output=True, text=True)
        if r.returncode == 0: return name, out
        print("  could not convert %s: %s" % (name, r.stderr.strip().splitlines()[-1:] if r.stderr else "?"), flush=True)
    return None, None


def opus_translate(name, path, texts):
    import ctranslate2
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(name)
    tr = ctranslate2.Translator(path, device="cpu", compute_type="int8", intra_threads=os.cpu_count() or 2)
    src = [tok.convert_ids_to_tokens(tok.encode(t[:1200])) for t in texts]
    t0 = time.time()
    res = tr.translate_batch(src, beam_size=1, max_batch_size=16, max_decoding_length=256, repetition_penalty=1.2,
                             no_repeat_ngram_size=4)
    dt = time.time() - t0
    return [tok.decode(tok.convert_tokens_to_ids(r.hypotheses[0]), skip_special_tokens=True).strip() for r in res], dt


def madlad_translate(texts, lang):
    t0 = time.time()
    r = subprocess.run([sys.executable, "tools/mt/madlad.py"], input=json.dumps({"items": [{"text": t, "lang": lang} for t in texts]}),
                       capture_output=True, text=True, env={**os.environ, "MT_DIR": MADLAD, "MT_BUDGET": "3000"})
    if r.returncode != 0: raise RuntimeError(r.stderr[-400:])
    return [x or "" for x in json.loads(r.stdout)["out"]], time.time() - t0


def main():
    import sacrebleu
    os.makedirs(WORK, exist_ok=True); os.makedirs("probe-out", exist_ok=True)
    eng = fetch("newstest2019-src.eng.txt")
    heads = [x for x in json.load(open("tools/mt/probe_confidence_samples.json", encoding="utf-8"))["items"] if x.get("lang") in LANGS]
    report, rows = [], []
    for lang in LANGS:
        print("== " + lang, flush=True)
        name, path = opus_model(lang)
        try:
            ref = ntrex(NTREX[lang])
            pairs = [(s, e) for s, e in zip(ref, eng) if s.strip() and e.strip()][:N]
        except Exception as e:
            print("  no NTREX text: %s" % e, flush=True); pairs = []
        src, gold = [p[0] for p in pairs], [p[1] for p in pairs]
        h = [x for x in heads if x["lang"] == lang]
        line = {"lang": lang, "opus_model": name, "n": len(src), "headlines": len(h)}
        m_out, m_dt = madlad_translate(src + [x["text"] for x in h], lang)
        line["madlad_chrf"] = round(sacrebleu.corpus_chrf(m_out[:len(src)], [gold], word_order=2).score, 1) if src else None
        line["madlad_s_per_line"] = round(m_dt / max(1, len(src) + len(h)), 2)
        o_out = [""] * (len(src) + len(h))
        if name:
            o_out, o_dt = opus_translate(name, path, src + [x["text"] for x in h])
            line["opus_chrf"] = round(sacrebleu.corpus_chrf(o_out[:len(src)], [gold], word_order=2).score, 1) if src else None
            line["opus_s_per_line"] = round(o_dt / max(1, len(src) + len(h)), 2)
        print("  " + json.dumps(line), flush=True)
        report.append(line)
        for k, x in enumerate(h):
            rows.append({"lang": lang, "set": x.get("set"), "text": x["text"], "madlad": m_out[len(src) + k], "opus": o_out[len(src) + k]})
        # a few NTREX lines side by side, for a person to read
        for k in range(min(4, len(src))):
            rows.append({"lang": lang, "set": "ntrex", "text": src[k], "gold": gold[k], "madlad": m_out[k], "opus": o_out[k]})
    json.dump({"summary": report, "rows": rows}, open("probe-out/mt-opus.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
