"""One-time setup for tools/mt/nllb.py: download facebook/nllb-200-distilled-600M from Hugging Face and convert it to
CTranslate2 int8 in NLLB_DIR, with its SentencePiece model. The refresh workflow keeps the result in the Actions cache,
so this only runs when the cache is empty. Needs transformers, torch (CPU) and huggingface_hub, installed by the workflow."""
import os, shutil
from huggingface_hub import hf_hub_download
import ctranslate2

REPO = "facebook/nllb-200-distilled-600M"
out = os.environ.get("NLLB_DIR", os.path.expanduser("~/.cache/osap-nllb/nllb-200-distilled-600M-ct2-int8"))
if os.path.exists(os.path.join(out, "model.bin")):
    print("model already in", out)
else:
    tmp = out + ".tmp"; shutil.rmtree(tmp, ignore_errors=True)
    ctranslate2.converters.TransformersConverter(REPO).convert(tmp, quantization="int8")
    shutil.copy(hf_hub_download(REPO, "sentencepiece.bpe.model"), os.path.join(tmp, "sentencepiece.bpe.model"))
    os.makedirs(os.path.dirname(out), exist_ok=True); os.replace(tmp, out)
    print("converted", REPO, "to", out, sorted(os.listdir(out)))
