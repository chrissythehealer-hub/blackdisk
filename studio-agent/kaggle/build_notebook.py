"""
Builds wan22_first_video.ipynb — a Kaggle notebook that generates ONE real Wan 2.2 TI2V 5B clip
(text-to-video by default, or image-to-video) on Kaggle's free GPU, using the studio's own
comfy.py + workflows.py (embedded below, so the notebook is self-contained).

It is also published at /studio/blackdisk-ai-studio.ipynb; the studio page rewrites the
settings cell (step 5) in the browser. Run `npm run build:studio` after rebuilding.

    python studio-agent/kaggle/build_notebook.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT = os.path.dirname(HERE)


def src(name):
    with open(os.path.join(AGENT, name), encoding="utf-8") as f:
        return f.read()


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n")}


def code(text):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": text.strip("\n")}


cells = [
    md("""
# BLVCKDISK AI Studio — one real video (Kaggle, free GPU)

Generates **one** short clip (text-to-video or image-to-video) with **Wan 2.2 TI2V 5B** (Apache-2.0) in ComfyUI, on Kaggle's free GPU.
Settings prepared on blackdisk.co/studio are already filled in at step 5 — **you don't need to edit anything.**
If you chose image-to-video there, your image is already inside this notebook too.

1. Right sidebar → *Session options* → **Accelerator: GPU T4 x2** and **Internet: On**.
2. **Save Version → Save & Run All (Commit)**. It runs on Kaggle's servers; you can close this tab.
3. When the version shows ✓, open its **Output** and download **`first_video.mp4`**.

The first run downloads ~17 GB of model files. Nothing here costs money.
"""),
    md("## 1 · Check the machine"),
    code("""
import shutil, subprocess, os
gpu_info = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv"], capture_output=True, text=True).stdout if shutil.which("nvidia-smi") else ""
print(gpu_info)
assert gpu_info, "❌ NO GPU. Session options → Accelerator → GPU T4 x2, then Save & Run All again."
print(f"RAM: {os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') / 1024**3:.1f} GB")
WORK = "/kaggle/temp" if os.path.isdir("/kaggle/temp") else "/tmp"
os.makedirs(WORK, exist_ok=True)
free = shutil.disk_usage(WORK).free / 1024**3
print(f"Free disk in {WORK}: {free:.0f} GB")
assert free > 25, "Need ~25 GB free for ComfyUI + models."
"""),
    md("## 2 · Install ComfyUI (official repository)"),
    code("""
COMFY = f"{WORK}/ComfyUI"
if not os.path.isdir(COMFY):
    !git clone --depth 1 https://github.com/comfyanonymous/ComfyUI {COMFY}
# Keep Kaggle's preinstalled PyTorch (CUDA build); install the rest.
!grep -viE '^(torch|torchvision|torchaudio)([^a-z]|$)' {COMFY}/requirements.txt > /tmp/comfy-req.txt
!pip install -q -r /tmp/comfy-req.txt
!cd {COMFY} && git log -1 --format='ComfyUI commit %h (%cs)'
"""),
    md("## 3 · Download the model (official ComfyUI repackage on Hugging Face, ~17 GB, Apache-2.0)"),
    code("""
FILES = {
    "diffusion_models/wan2.2_ti2v_5B_fp16.safetensors": "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors",
    "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors": "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "vae/wan2.2_vae.safetensors": "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors",
}
for rel, url in FILES.items():
    dest = f"{COMFY}/models/{rel}"
    if os.path.exists(dest) and os.path.getsize(dest) > 1e8:
        print("already have", rel); continue
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print("downloading", rel)
    !wget -q --show-progress -O {dest}.part "{url}" && mv {dest}.part {dest}
!du -sh {COMFY}/models/diffusion_models {COMFY}/models/text_encoders {COMFY}/models/vae
"""),
    md("## 4 · Studio workflow code (embedded copy of `studio-agent/comfy.py` and `workflows.py`)"),
    code("%%writefile /tmp/comfy.py\n" + src("comfy.py")),
    code("%%writefile /tmp/workflows.py\n" + src("workflows.py")),
    code("""
import sys, time, urllib.request
sys.path.insert(0, "/tmp")
log = open(f"{WORK}/comfyui.log", "w")
# Bound to 127.0.0.1 only — nothing is exposed to the internet.
server = subprocess.Popen([sys.executable, "main.py", "--listen", "127.0.0.1", "--port", "8188"], cwd=COMFY, stdout=log, stderr=subprocess.STDOUT)
for _ in range(180):
    try:
        urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2); break
    except Exception:
        time.sleep(2)
else:
    raise RuntimeError("ComfyUI did not start — see the log: " + open(f"{WORK}/comfyui.log").read()[-3000:])
from comfy import ComfyClient
comfy = ComfyClient("http://127.0.0.1:8188")
comfy.start_progress_listener()
dev = comfy.system_stats()["devices"][0]
print("ComfyUI running on", dev["name"], f"({dev['vram_total']/1024**3:.1f} GB VRAM)")
"""),
    md("""
## 5 · Your settings (filled in by blackdisk.co/studio — no edits needed)

Image-to-video uses, in order: the image embedded by the studio (`IMAGE_DATA`), an `IMAGE_URL`,
or the first image you uploaded under **Input** (`/kaggle/input/…`).

Start small to prove it works: **draft size, 49 frames (≈2 s)**. Bigger settings take much longer on a T4.
"""),
    code("""
import glob
MODE = "text"           # "text" = video from the prompt alone · "image" = animate your uploaded image
IMAGE_URL = ""          # optional: direct link to a public image instead of uploading
IMAGE_DATA = ""         # image embedded by blackdisk.co/studio (base64); empty = none
PROMPT = "A small red sports car driving along a coastal road at sunset, cinematic lighting, natural wheel movement, smooth camera tracking, realistic motion."
SIZE = "auto"           # auto picks 9x16-draft or 16x9-draft from the image shape; or e.g. "9x16", "16x9", "1x1"
FRAMES = 49             # 25, 49, 81 or 121 (24 fps)
STEPS = 20
CFG = 5.0               # how closely to follow the prompt (1–10)
NEGATIVE = ""           # what to avoid; empty = the model's recommended list
SEED = 42

if MODE == "text":
    IMAGE = None
elif IMAGE_DATA:
    import base64
    raw = base64.b64decode(IMAGE_DATA)
    ext = ".png" if raw[:8] == b"\\x89PNG\\r\\n\\x1a\\n" else ".webp" if raw[8:12] == b"WEBP" else ".jpg"
    IMAGE = f"{WORK}/reference{ext}"
    open(IMAGE, "wb").write(raw)
elif IMAGE_URL:
    IMAGE = f"{WORK}/reference" + os.path.splitext(IMAGE_URL.split("?")[0])[1].lower()
    urllib.request.urlretrieve(IMAGE_URL, IMAGE)
else:
    found = sorted(p for ext in ("png", "jpg", "jpeg", "webp", "PNG", "JPG", "JPEG", "WEBP") for p in glob.glob(f"/kaggle/input/**/*.{ext}", recursive=True))
    assert found, "❌ No image found. Prepare the notebook again on blackdisk.co/studio with your image, or upload one under Input."
    IMAGE = found[0]
from PIL import Image
w, h = Image.open(IMAGE).size if IMAGE else (16, 9)
if SIZE == "auto":
    SIZE = "9x16-draft" if h > w else "16x9-draft"
print("Mode:", MODE, "| image:", IMAGE, "→ size", SIZE)
Image.open(IMAGE).resize((w * 240 // max(w, h), h * 240 // max(w, h))) if IMAGE else None
"""),
    md("## 6 · Generate (real progress from ComfyUI)"),
    code("""
from workflows import build_graph, validate_params, STAGE_BY_NODE
WORKFLOW = "wan22-t2v" if MODE == "text" else "wan22-i2v"
params = validate_params(WORKFLOW, {"prompt": PROMPT, "size": SIZE, "frames": FRAMES, "steps": STEPS, "cfg": CFG, "seed": SEED, "negative": NEGATIVE or None})
image_name = None
if IMAGE:
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}[os.path.splitext(IMAGE)[1].lower()]
    image_name = comfy.upload_image("reference" + os.path.splitext(IMAGE)[1].lower(), open(IMAGE, "rb").read(), mime)
prompt_id = comfy.queue_prompt(build_graph(WORKFLOW, params, image_name, "studio/kaggle_first"))
print("Queued", prompt_id, params)

t0, last = time.time(), ""
while True:
    hist = comfy.history(prompt_id)
    if hist:
        break
    p = comfy.progress_for(prompt_id)
    line = f"{STAGE_BY_NODE.get(str(p['node']), 'Working')} {p['value']}/{p['max']}" if p else "Loading models (first time takes a few minutes)"
    if line != last:
        print(f"[{int(time.time()-t0):>4}s] {line}"); last = line
    time.sleep(3)

status = hist.get("status", {})
if status.get("status_str") == "error":
    msgs = [m[1].get("exception_message") for m in status.get("messages", []) if m[0] == "execution_error"]
    hint = ("The GPU ran out of memory: prepare again with a Draft size or a shorter length."
            if any("out of memory" in str(m).lower() for m in msgs) else "Try Save & Run All once more; if it fails again, prepare with a Draft size.")
    raise RuntimeError(f"❌ GENERATION FAILED. {hint}\\nDetails: {msgs}\\nLast log lines:\\n" + open(f"{WORK}/comfyui.log").read()[-2000:])
out = next(i for node in hist["outputs"].values() for items in node.values() if isinstance(items, list) for i in items if isinstance(i, dict) and str(i.get("filename", "")).endswith(".mp4"))
RESULT = "/kaggle/working/first_video.mp4"
comfy.download_output(out["filename"], out.get("subfolder", ""), out.get("type", "output"), RESULT)
ELAPSED = int(time.time() - t0)
print(f"✅ YOUR VIDEO IS READY — generated in {ELAPSED}s ({os.path.getsize(RESULT)/1e6:.1f} MB).")
print("Download it: this version's Output → first_video.mp4. Then import it on blackdisk.co/studio.")
"""),
    md("## 7 · Check, watch and download"),
    code("""
print(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,nb_frames:format=duration", "-of", "default=nw=1", RESULT], capture_output=True, text=True).stdout or "(ffprobe not available)")
from IPython.display import Video, FileLink, display
display(Video(RESULT, embed=True, width=360))
display(FileLink("first_video.mp4"))  # also in the right sidebar → Output → first_video.mp4
"""),
    md("## 8 · Gallery entry (for publishing this clip on blackdisk.co/studio)"),
    code("""
import json, datetime
gpu = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True).stdout.splitlines()[0].strip()
size = next(s for s in __import__("workflows").WAN22_SIZES if s["id"] == params["size"])
print(json.dumps({
    "id": f"clip-{datetime.date.today():%Y%m%d}-{params['seed']}",
    "title": "",
    "date": f"{datetime.date.today()}",
    "video": "/studio/videos/REPLACE.mp4",
    "mode": "text-to-video" if WORKFLOW == "wan22-t2v" else "image-to-video",
    "prompt": params["prompt"],
    "width": size["width"], "height": size["height"],
    "frames": params["frames"], "fps": 24, "steps": params["steps"], "cfg": params["cfg"], "seed": params["seed"],
    "gpu": gpu, "seconds": ELAPSED,
}, indent=2, ensure_ascii=False))
"""),
    md("""
### Then
- Download `first_video.mp4` (right sidebar → **Output**) and keep the gallery entry above with it.
- Stop the session (power icon) so you don't use up free GPU hours.
- Try more: change `PROMPT`/`SEED`, `FRAMES = 81`, or `SIZE = "9x16"` (native 720p, much slower) and re-run steps 5–8 only.
"""),
]

nb = {
    "cells": cells,
    "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}},
    "nbformat": 4,
    "nbformat_minor": 5,
}
out = os.path.join(HERE, "wan22_first_video.ipynb")
with open(out, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)
print("wrote", out)
