"""
Builds studio/kaggle/wan22_first_video.ipynb (served at /studio/kaggle/) — a Kaggle notebook that generates ONE real image-to-video clip
with Wan 2.2 TI2V 5B on Kaggle's free GPU, using the studio's own comfy.py + workflows.py
(embedded below, so the notebook needs no access to this private repository).

    python3 studio-agent/kaggle/build_notebook.py
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
# Blackdisk AI Studio — first real video (Kaggle, free GPU)

Generates **one** image-to-video clip with **Wan 2.2 TI2V 5B** (Apache-2.0) in ComfyUI, on Kaggle's free GPU.
It uses the exact workflow code from the website's studio agent, so success here also proves that code.

**Before running:** right sidebar → *Session options* → **Accelerator: GPU T4 x2** and **Internet: On**.
Then upload your image (step 5) and use **Run All**. The first run downloads ~17 GB of model files.
Nothing here costs money. When finished, click **Stop session** (power icon) to save your weekly GPU hours.
"""),
    md("## 1 · Check the machine"),
    code("""
import shutil, subprocess, os
print(subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv"], capture_output=True, text=True).stdout or "NO GPU — set Accelerator to GPU T4 x2 in Session options, then restart.")
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
## 5 · Your reference image and prompt

Set `MODE = "text"` to generate from the prompt alone (no upload needed), or keep `"image"` and upload a photo:
right sidebar → **Input** → **Upload** → *New Dataset* → add your photo (PNG/JPEG/WebP) → **Create**.
It appears under `/kaggle/input/…`. The first image found there is used. Or set `IMAGE_URL` to a public image link.

Start small to prove it works: **draft size, 49 frames (≈2 s)**. Bigger settings take much longer on a T4.
"""),
    code("""
import glob
MODE = "text"           # "text" = video from the prompt alone · "image" = animate your uploaded image
IMAGE_URL = ""          # optional: direct link to a public image instead of uploading
PROMPT = "A small red sports car driving along a coastal road at sunset, cinematic lighting, natural wheel movement, smooth camera tracking, realistic motion."
SIZE = "auto"           # auto picks 9x16-draft or 16x9-draft from the image shape; or e.g. "9x16", "16x9", "1x1"
FRAMES = 49             # 25, 49, 81 or 121 (24 fps)
STEPS = 20
SEED = 42

if MODE == "text":
    IMAGE = None
elif IMAGE_URL:
    IMAGE = f"{WORK}/reference" + os.path.splitext(IMAGE_URL.split("?")[0])[1].lower()
    urllib.request.urlretrieve(IMAGE_URL, IMAGE)
else:
    found = sorted(p for ext in ("png", "jpg", "jpeg", "webp", "PNG", "JPG", "JPEG", "WEBP") for p in glob.glob(f"/kaggle/input/**/*.{ext}", recursive=True))
    assert found, "No image found. Upload one (see above) or set IMAGE_URL."
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
params = validate_params(WORKFLOW, {"prompt": PROMPT, "size": SIZE, "frames": FRAMES, "steps": STEPS, "seed": SEED})
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
    raise RuntimeError(f"Generation failed: {msgs} — last log lines:\\n" + open(f"{WORK}/comfyui.log").read()[-2000:])
out = next(i for node in hist["outputs"].values() for items in node.values() if isinstance(items, list) for i in items if isinstance(i, dict) and str(i.get("filename", "")).endswith(".mp4"))
RESULT = "/kaggle/working/first_video.mp4"
comfy.download_output(out["filename"], out.get("subfolder", ""), out.get("type", "output"), RESULT)
print(f"Done in {int(time.time()-t0)}s →", RESULT, f"({os.path.getsize(RESULT)/1e6:.1f} MB)")
"""),
    md("## 7 · Check, watch and download"),
    code("""
print(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,nb_frames:format=duration", "-of", "default=nw=1", RESULT], capture_output=True, text=True).stdout or "(ffprobe not available)")
from IPython.display import Video, FileLink, display
display(Video(RESULT, embed=True, width=360))
display(FileLink("first_video.mp4"))  # also in the right sidebar → Output → first_video.mp4
"""),
    md("""
### Then
- Tell Claude: the GPU shown in step 1, the time printed in step 6, and whether the video looks right.
- Stop the session (power icon) so you don't use up free GPU hours.
- Try more: change `PROMPT`/`SEED`, `FRAMES = 81`, or `SIZE = "9x16"` (native 720p, much slower) and re-run steps 5–7 only.
"""),
]

nb = {
    "cells": cells,
    "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}},
    "nbformat": 4,
    "nbformat_minor": 5,
}
# The AI Studio page downloads this file and fills in the settings cell in the browser.
out = os.path.join(AGENT, "..", "studio", "kaggle", "wan22_first_video.ipynb")
with open(out, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)
print("wrote", out)
