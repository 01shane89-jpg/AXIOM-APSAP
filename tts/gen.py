import json, sys, os, soundfile as sf, numpy as np
from kokoro import KPipeline
lines = json.load(open("tts/lines.json"))
pipe = KPipeline(lang_code="a")
for voice in ["af_heart", "am_michael", "am_fenrir"]:
    os.makedirs(f"out/{voice}", exist_ok=True)
    for key, text in lines:
        audio = [a for _, _, a in pipe(text, voice=voice, speed=1.0)]
        wav = np.concatenate([np.asarray(a) for a in audio])
        sf.write(f"out/{voice}/{key}.wav", wav, 24000)
        print(voice, key, round(len(wav) / 24000, 2))
