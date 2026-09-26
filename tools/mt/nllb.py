"""Machine translation to English with Meta's NLLB-200 (distilled 600M), run on the job's own CPU.

Reads {"items": [{"text": ..., "lang": ...}]} as JSON on stdin and writes {"out": [english or null, ...]} on stdout.
The model is converted once to CTranslate2 int8 by tools/mt/setup_nllb.py and kept in the Actions cache (NLLB_DIR).
No network use at translation time. Licence: the NLLB-200 weights are CC-BY-NC 4.0 (non-commercial); this file is the
only place that knows about them, so a commercially licensed model can replace it behind the same stdin/stdout contract.
Untrusted text is only ever data here: it is tokenised and translated, never interpreted.
"""
import json, os, re, sys

MODEL_DIR = os.environ.get("NLLB_DIR", os.path.expanduser("~/.cache/osap-nllb/nllb-200-distilled-600M-ct2-int8"))
MAX_CHARS, CHUNK = 1200, 350

# ISO 639 codes used by the feeds -> NLLB-200 language codes
ISO = {"th": "tha_Thai", "my": "mya_Mymr", "km": "khm_Khmr", "lo": "lao_Laoo", "si": "sin_Sinh", "dv": "div_Thaa" , "ne": "npi_Deva",
       "hi": "hin_Deva", "bn": "ben_Beng", "ur": "urd_Arab", "ta": "tam_Taml", "dz": "dzo_Tibt", "bo": "bod_Tibt", "zh": "zho_Hans",
       "zh-tw": "zho_Hant", "zh-hant": "zho_Hant", "ja": "jpn_Jpan", "ko": "kor_Hang", "vi": "vie_Latn", "id": "ind_Latn",
       "ms": "zsm_Latn", "tl": "tgl_Latn", "fil": "tgl_Latn", "mn": "khk_Cyrl", "ps": "pbt_Arab", "fa": "pes_Arab", "ar": "arb_Arab",
       "ru": "rus_Cyrl", "fr": "fra_Latn", "es": "spa_Latn", "pt": "por_Latn", "de": "deu_Latn", "tet": "tet_Latn", "tpi": "tpi_Latn",
       "sm": "smo_Latn", "fj": "fij_Latn", "mi": "mri_Latn", "ceb": "ceb_Latn", "jv": "jav_Latn", "su": "sun_Latn", "pa": "pan_Guru",
       "gu": "guj_Gujr", "mr": "mar_Deva", "te": "tel_Telu", "kn": "kan_Knda", "ml": "mal_Mlym", "or": "ory_Orya", "as": "asm_Beng",
       "ug": "uig_Arab", "kk": "kaz_Cyrl", "ky": "kir_Cyrl", "uz": "uzn_Latn", "tg": "tgk_Cyrl", "tk": "tuk_Latn", "shn": "shn_Mymr"}
# when a feed gives no language, guess from the script (Latin-script text with no language is left as it is)
SCRIPTS = [(r"[฀-๿]", "tha_Thai"), (r"[က-႟]", "mya_Mymr"), (r"[ក-៿]", "khm_Khmr"), (r"[຀-໿]", "lao_Laoo"),
           (r"[඀-෿]", "sin_Sinh"), (r"[ހ-޿]", "div_Thaa"), (r"[ༀ-࿿]", "dzo_Tibt"), (r"[ঀ-৿]", "ben_Beng"),
           (r"[ऀ-ॿ]", "hin_Deva"), (r"[஀-௿]", "tam_Taml"), (r"[가-힯]", "kor_Hang"), (r"[぀-ヿ]", "jpn_Jpan"),
           (r"[一-鿿]", "zho_Hans"), (r"[؀-ۿ]", "urd_Arab"), (r"[Ѐ-ӿ]", "rus_Cyrl")]

def src_code(text, lang):
    l = (lang or "").lower()
    for c in (l, l.split("-")[0]):
        if c in ISO:
            code = ISO[c]
            # a Chinese feed may be in traditional characters; the model's simplified path handles both acceptably
            return code
    for rx, code in SCRIPTS:
        if re.search(rx, text or ""): return code
    return None

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
    req = json.load(sys.stdin); items = req.get("items", [])
    import ctranslate2, sentencepiece as spm
    sp = spm.SentencePieceProcessor(model_file=os.path.join(MODEL_DIR, "sentencepiece.bpe.model"))
    tr = ctranslate2.Translator(MODEL_DIR, device="cpu", compute_type="int8", inter_threads=1, intra_threads=os.cpu_count() or 2)
    jobs = []  # (item index, chunk tokens, source code)
    for i, it in enumerate(items):
        code = src_code(it.get("text"), it.get("lang"))
        if not code or not (it.get("text") or "").strip(): continue
        for c in chunks(it["text"]): jobs.append((i, [code] + sp.encode(c, out_type=str) + ["</s>"]))
    res = tr.translate_batch([j[1] for j in jobs], target_prefix=[["eng_Latn"]] * len(jobs), beam_size=2, max_batch_size=32,
                             batch_type="examples", max_decoding_length=256) if jobs else []
    out = [None] * len(items)
    for (i, _), r in zip(jobs, res):
        toks = r.hypotheses[0][1:] if r.hypotheses[0][:1] == ["eng_Latn"] else r.hypotheses[0]
        en = sp.decode(toks).strip()
        out[i] = (out[i] + " " + en).strip() if out[i] else en
    json.dump({"out": out}, sys.stdout, ensure_ascii=False)

if __name__ == "__main__":
    main()
