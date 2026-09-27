"""One-time setup for tools/mt/madlad.py: download google/madlad400-3b-mt (Apache-2.0) from Hugging Face and convert it
to CTranslate2 int8 in MT_DIR, with its SentencePiece model. The refresh workflow keeps the result in the Actions cache,
so this only runs when the cache is empty. Needs transformers, torch (CPU) and huggingface_hub, installed by the workflow."""
import os, shutil
from huggingface_hub import hf_hub_download, list_repo_files
import ctranslate2

REPO = "google/madlad400-3b-mt"
out = os.environ.get("MT_DIR", os.path.expanduser("~/.cache/osap-mt/madlad400-3b-mt-ct2-int8"))
if os.path.exists(os.path.join(out, "model.bin")):
    print("model already in", out)
else:
    tmp = out + ".tmp"; shutil.rmtree(tmp, ignore_errors=True)
    # load in half precision to keep memory within a standard runner; the stored weights are int8
    ctranslate2.converters.TransformersConverter(REPO, load_as_float16=True, low_cpu_mem_usage=True).convert(tmp, quantization="int8")
    spm = [f for f in list_repo_files(REPO) if f.endswith(".model")][0]  # the SentencePiece vocabulary
    shutil.copy(hf_hub_download(REPO, spm), os.path.join(tmp, "spiece.model"))
    os.makedirs(os.path.dirname(out), exist_ok=True); os.replace(tmp, out)
    print("converted", REPO, "to", out, sorted(os.listdir(out)))
