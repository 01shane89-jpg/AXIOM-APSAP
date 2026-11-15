import subprocess, json, sys, os, wave
V=sys.argv[1]; OUT=sys.argv[2]
W="../rec/out/_work/vertical"; T=f"work-{V}"; os.makedirs(T,exist_ok=True)
def dur(f): return float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f]))
def ff(*a): subprocess.run(["ffmpeg","-nostdin","-v","error","-y",*a],check=True)
ENC=["-c:v","libx264","-preset","medium","-crf","16","-pix_fmt","yuv420p","-r","30"]
groups=[("intro",["still:intro"]),("hook",["002-deeper","003-deeper"]),("tap",["004-deeper"]),("story",["005-deeper"]),("claims",["006-deeper"]),
 ("timeline",["007-deeper"]),("links",["008-deeper"]),("mark",["009-deeper"]),("follow",["010-deeper"]),("back",["011-deeper"]),
 ("reports",["012-deeper"]),("about",["013-deeper"]),("print",["014-deeper"]),("uses",["still:uses"]),("outro",["still:outro"])]
LEAD,TAIL=0.15,0.35
parts=[]; t=0; cues=[]
for key,pieces in groups:
    sp=dur(f"out/{V}/{key}.wav"); need=LEAD+sp+TAIL
    if pieces[0].startswith("still:"):
        name=pieces[0][6:]; secs=max(need,{"intro":3.2,"uses":5.2,"outro":4.2}[name]+(0.6 if name=="outro" else 0))
        o=f"{T}/{key}.mp4"; ff("-loop","1","-t",f"{secs:.3f}","-i",f"{W}/{name}.png","-vf",f"scale=1080:1920,fade=t=in:st=0:d=0.35,fade=t=out:st={secs-0.35:.3f}:d=0.35",*ENC,o)
        parts.append(o); cues.append((key,t+LEAD)); t+=secs; continue
    have=sum(dur(f"{W}/{p}.mp4") for p in pieces); pad=max(0,need-have)
    for i,p in enumerate(pieces):
        src=f"{W}/{p}.mp4"
        if i==len(pieces)-1 and pad>0.02:
            o=f"{T}/{p}-pad.mp4"; ff("-i",src,"-vf",f"tpad=stop_mode=clone:stop_duration={pad:.3f}",*ENC,o); parts.append(o)
        else: parts.append(src)
    cues.append((key,t+LEAD)); t+=have+pad
open(f"{T}/list.txt","w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in parts))
ff("-f","concat","-safe","0","-i",f"{T}/list.txt",*ENC,f"{T}/video.mp4")
total=dur(f"{T}/video.mp4")
# voice track
ins=[];fl=[]
for i,(k,c) in enumerate(cues):
    ins+=["-i",f"out/{V}/{k}.wav"]; fl.append(f"[{i}:a]aresample=48000,adelay={int(c*1000)}:all=1[a{i}]")
n=len(cues)
ff(*ins,"-filter_complex",";".join(fl)+";"+"".join(f"[a{i}]" for i in range(n))+f"amix=inputs={n}:normalize=0,apad,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5[v]","-map","[v]","-ar","48000",f"{T}/voice.wav")
json.dump({"total":total,"cues":cues},open(f"{T}/cues.json","w"),indent=1)
M="/mnt/project-files/osap-instagram-carousels/music/epic/ES_APEX - Lennon Hutton.mp3"
fo=total-2.5
ff("-i",f"{T}/video.mp4","-i",f"{T}/voice.wav","-i",M,"-filter_complex",
 f"[2:a]aresample=48000,atrim=0:{total:.3f},loudnorm=I=-22:TP=-3,afade=t=in:d=0.8,afade=t=out:st={fo:.3f}:d=2.5[m];[1:a]asplit=2[vs][vo];[m][vs]sidechaincompress=threshold=0.015:ratio=10:attack=20:release=400:makeup=1[md];[vo][md]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5[a]",
 "-map","0:v","-map","[a]","-c:v","copy","-c:a","aac","-b:a","160k","-movflags","+faststart",OUT)
ff("-i",f"{T}/video.mp4","-i",f"{T}/voice.wav","-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","160k","-movflags","+faststart",OUT.replace(".mp4","-voice-only.mp4"))
print(V,"total",round(total,1))
