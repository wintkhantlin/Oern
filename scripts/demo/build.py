"""Assemble the walkthrough: straight cuts per role, sped-up drives and role slides.

Outputs a clean video, a version with YouTube-style captions burned in, and matching
SRT / VTT caption files plus a full-sentence transcript."""
import json, os, re, subprocess, sys, textwrap
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(__file__), "../../output/demo-recording")
os.chdir(OUT)
src = lambda name: json.load(open(f"{name}.marks.json"))["video"]
A, V, F, CU, M = src("rider-v4a"), src("rider-v8"), src("rider-v9"), src("customer-v5"), src("manager-v2")
# (source, in, out, speed, caption)
SECTIONS = {
    "driver": [
        (A, 16.0, 20.3, 1, "jobs"), (V, 15.0, 23.5, 2, "drive"),
        (V, 24.0, 37.0, 1, "door"), (V, 37.0, 42.0, 1, "cash"),
        (F, 12.5, 22.0, 2, "onward"), (F, 22.0, 27.0, 1, "fuel"),
        (F, 27.0, 49.0, 3, "pitstop"), (F, 49.0, 51.5, 1, "done"),
        (F, 51.5, 64.0, 2, "next"),
    ],
    "customer": [
        (CU, 8.0, 12.0, 1, "c-home"), (CU, 18.0, 26.5, 1, "c-map"), (CU, 30.5, 38.8, 1, "c-drop"),
        (CU, 40.0, 46.5, 1, "c-who"), (CU, 47.0, 52.5, 1, "c-fee"), (CU, 55.3, 58.3, 1, "c-sent"),
        (CU, 65.0, 71.0, 1, "c-pay"), (CU, 71.0, 73.7, 1, "c-track"), (CU, 75.25, 76.2, 1, "c-track"),
    ],
    "manager": [
        (M, 13.5, 19.5, 1, "m-over"), (M, 26.0, 32.0, 1, "m-orders"), (M, 38.5, 46.5, 1, "m-jobs"),
        (M, 50.5, 57.0, 1, "m-track"), (M, 63.5, 71.0, 1, "m-lab"), (M, 79.5, 83.0, 1, "m-fleet"),
        (M, 84.5, 91.0, 1, "m-cod"),
    ],
}
ff = lambda *a: subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *a], check=True)
dur = lambda p: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))
ENC = ["-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-an"]
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs("parts", exist_ok=True)
for f in os.listdir("parts"): os.remove(f"parts/{f}")
subprocess.run(["node", f"{HERE}/title-cards.mjs"], check=True)
subprocess.run(["node", f"{HERE}/end-card.mjs"], check=True)
open("cues.json", "w").write("[]")
subprocess.run(["node", f"{HERE}/render-captions.mjs"], check=True)  # phone mask and shadow

# 1. Scene parts (no captions), sections, slides.
for role, parts in SECTIONS.items():
    names = []
    for i, (s, a, b, speed, cap) in enumerate(parts):
        out = f"parts/{role}-{i:02d}.mp4"
        length = (b - a) / speed
        if role != "manager":
            # Phone scenes fill 16:9: a solid navy backdrop behind a rounded, shadowed phone (416x900 at 752,40).
            still = lambda f: ["-loop", "1", "-t", f"{length + 0.2:.2f}", "-i", f]
            fc = (f"[0:v]crop=390:844:0:0,setsar=1,setpts=(PTS-STARTPTS)/{speed},fps=30,split[a][b];"
                  "[a]scale=1920:1080,setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=0x1b2433:t=fill[bg];"
                  "[b]scale=416:900:flags=lanczos,format=rgba[ph];[1:v]format=gray[m];[ph][m]alphamerge[pr];"
                  "[bg][2:v]overlay=0:0[bs];[bs][pr]overlay=752:40,format=yuv420p")
            inputs = still("captions/_phone-mask.png") + still("captions/_phone-shadow.png")
        else:
            fc = f"[0:v]crop=1600:900:0:0,scale=1920:1080:flags=lanczos,setsar=1,setpts=(PTS-STARTPTS)/{speed},fps=30,format=yuv420p"
            inputs = []
        ff("-ss", str(a), "-to", str(b), "-i", s, *inputs, "-filter_complex", fc, "-t", f"{length:.3f}", *ENC, out)
        names.append(out)
    open("s.txt", "w").write("".join(f"file {n}\n" for n in names))
    ff("-f", "concat", "-safe", "0", "-i", "s.txt", "-c", "copy", f"parts/sec-{role}.mp4")
    ff("-loop", "1", "-t", "2.2", "-i", f"card-{role}.png", "-vf", "scale=1920:1080,setsar=1,fps=30,format=yuv420p", *ENC, f"parts/card-{role}.mp4")
os.remove("s.txt")
# Ending: the mascot runs in once from the left (ease-out), the card holds, then the video fades out.
END_LEN, RUN = 4.0, 1.0
ff("-loop", "1", "-t", str(END_LEN), "-i", "end-bg.png", "-loop", "1", "-t", str(END_LEN), "-i", "end-mascot.png",
   "-filter_complex",
   f"[0:v]scale=1920:1080,setsar=1,fps=30[bg];[1:v]format=rgba,fps=30[m];"
   f"[bg][m]overlay=x='150-820*pow(1-min(max(t-0.5,0)/{RUN},1),3)':y=210:eval=frame,"
   f"fade=t=out:st={END_LEN - 0.7}:d=0.7,format=yuv420p",
   "-t", str(END_LEN), *ENC, "parts/end-oern.mp4")

# 2. Clean video (no captions).
seq = [f"parts/{k}-{r}.mp4" for r in SECTIONS for k in ("card", "sec")] + ["parts/end-oern.mp4"]
d = [dur(p) for p in seq]; X = 0.5
args = sum((["-i", p] for p in seq), [])
fc = ["[0:v]fade=t=in:st=0:d=0.5[a0]"]; prev = "[a0]"; t = d[0]
for i in range(1, len(seq)):
    off = t - X; fc.append(f"{prev}[{i}:v]xfade=transition=slideleft:duration={X}:offset={off:.3f}[a{i}]"); prev = f"[a{i}]"; t = off + d[i]
TOTAL = t
CLEAN = "oern-feature-walkthrough-no-captions.mp4"
ff(*args, "-filter_complex", ";".join(fc), "-map", prev, "-c:v", "libx264", "-crf", "18", "-preset", "medium",
   "-pix_fmt", "yuv420p", "-movflags", "+faststart", CLEAN)
print("sections", [round(x, 1) for x in d], "total", round(TOTAL, 2))

# 3. Timeline of what is said: slides and one full sentence block per scene.
spec = re.search(r"CARDS = \[([\s\S]*?)\];", open(f"{HERE}/title-cards.mjs").read()).group(1)
CARDS = {m[0]: (m[1], m[2]) for m in re.findall(r'\["(\w+)", "([^"]+)", "([^"]+)"\]', spec)}
caps = json.load(open(f"{HERE}/captions.json"))
blocks, start = [], 0.0  # (start, end, text, role, is_slide, pos)
for i, p in enumerate(seq):
    kind, role = os.path.basename(p)[:-4].split("-", 1)
    if kind == "end":
        blocks.append((start, start + d[i], "Oern. Door-to-door delivery for Yangon. Try it at oern-app.vercel.app.", "end", True, "bottom"))
    elif kind == "card":
        title, line = CARDS[role]
        blocks.append((start, start + d[i] - X, f"{title}. {line}", role, True, "bottom"))
    else:
        t = start
        for j, part in enumerate(SECTIONS[role]):
            pd = dur(f"parts/{role}-{j:02d}.mp4")
            c = caps[part[4]]
            text = (f"({c['fast']}) " if c.get("fast") else "") + c["text"]
            if blocks and blocks[-1][2] == text and not blocks[-1][4]:  # same caption continues across a cut
                blocks[-1] = (blocks[-1][0], t + pd, *blocks[-1][2:])
            else:
                blocks.append((t, t + pd, text, role, False, c.get("pos", "bottom")))
            t += pd
    start += d[i] - X

# 4. YouTube-style cues: at most 2 lines of ~42 characters, split at sentence breaks, timed by length.
def cue_chunks(text, slide=False):
    out = []
    for sentence in ([text] if slide else re.split(r"(?<=[.!?])\s+", text)):
        lines = textwrap.wrap(sentence, 42)
        out += [lines[k:k + 2] for k in range(0, len(lines), 2)]
    return out
cues = []
for a, b, text, role, slide, pos in blocks:
    chunks = cue_chunks(text, slide)
    weights = [max(12, sum(map(len, c))) for c in chunks]
    t = a
    for c, w in zip(chunks, weights):
        e = t + (b - a) * w / sum(weights)
        cues.append({"id": f"cue{len(cues):03d}", "start": round(t, 3), "end": round(e - 0.04, 3), "lines": c, "pos": pos, "slide": slide})
        t = e
json.dump(cues, open("cues.json", "w"), ensure_ascii=False, indent=1)
subprocess.run(["node", f"{HERE}/render-captions.mjs"], check=True)

# 5. Burned-in version. Slides already show their text, so their cues stay in the caption files only.
burn = [c for c in cues if not c["slide"]]
args = ["-i", CLEAN] + sum((["-i", f"captions/{c['id']}.png"] for c in burn), [])
fc, prev = [], "[0:v]"
for k, c in enumerate(burn, 1):
    fc.append(f"{prev}[{k}:v]overlay=0:0:enable='between(t,{c['start']},{c['end']})'[o{k}]"); prev = f"[o{k}]"
ff(*args, "-filter_complex", ";".join(fc), "-map", prev, "-c:v", "libx264", "-crf", "18", "-preset", "medium",
   "-pix_fmt", "yuv420p", "-movflags", "+faststart", "oern-feature-walkthrough.mp4")

# 6. Caption files and transcript.
os.makedirs("transcripts", exist_ok=True)
for f in os.listdir("transcripts"): os.remove(f"transcripts/{f}")
def stamp(t, sep):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s_, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s_:02d}{sep}{ms:03d}"
with open("transcripts/oern-feature-walkthrough.en.srt", "w") as f:
    for n, c in enumerate(cues, 1):
        f.write(f"{n}\n{stamp(c['start'], ',')} --> {stamp(c['end'], ',')}\n" + "\n".join(c["lines"]) + "\n\n")
with open("transcripts/oern-feature-walkthrough.en.vtt", "w") as f:
    f.write("WEBVTT\n\n")
    for c in cues:
        f.write(f"{stamp(c['start'], '.')} --> {stamp(c['end'], '.')}{' line:8%' if c['pos'] == 'top' else ''}\n" + "\n".join(c["lines"]) + "\n\n")
with open("transcripts/oern-feature-walkthrough-transcript.txt", "w") as f:
    f.write(f"Oern Feature Walkthrough ({int(TOTAL // 60)}:{int(TOTAL % 60):02d})\n")
    for a, b, text, role, slide, pos in blocks:
        if slide: f.write(f"\n{role.upper()}\n\n")
        f.write(f"[{int(a // 60)}:{a % 60:04.1f}] {text}\n\n")
print("cues:", len(cues), "burned:", len(burn))
