# AI Studio — generation backend

> **Status on blackdisk.co:** the public `/studio/` page runs generation through **Kaggle's free GPU**
> (`kaggle/build_notebook.py` → `/studio/kaggle/wan22_first_video.ipynb`). Proven: Wan 2.2 TI2V-5B on a
> Tesla T4, 832×480 · 49 frames in 204 s, $0.
>
> The live agent below (`agent.py`) is kept for **later**, when an always-on GPU exists. The website half it
> pairs with (password session + signed tokens, `STUDIO_*` variables) is not part of this site yet, and live
> generation must not be enabled for public visitors without Cloudflare Turnstile and per-visitor limits.

## Later: studio computer setup (Windows)

This folder runs on **your Windows GPU computer**. It connects the `/studio` page on the website to ComfyUI and the AI model on that computer. Nothing here is deployed to Vercel.

```
Browser (/studio) ──HTTPS──► tunnel ──► agent.py (127.0.0.1:8787) ──► ComfyUI (127.0.0.1:8188) ──► GPU
        │
        └── /api/studio/session (Vercel): checks your password, issues 15-minute tokens the agent verifies
```

- ComfyUI is **never** exposed to the internet. Only the agent is, through the tunnel, and every request needs a token signed with your secret.
- Videos, uploads and projects are saved in `studio-agent/studio-data/` on this computer. When the computer is off or asleep, the studio shows **offline**: you can't generate or download anything until it's back on.
- Cost: everything here is free software. The real costs are electricity, about 30 GB of disk space, and your GPU being busy while it generates.

---

## Step 1 — Check your computer (5 minutes)

Open **PowerShell** (Start → type "PowerShell") and paste these one at a time. Send me the output.

```powershell
nvidia-smi
Get-CimInstance Win32_Processor | Select-Object Name
Get-ComputerInfo -Property OsName, OsVersion, CsTotalPhysicalMemory
Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{n="FreeGB";e={[math]::Round($_.Free/1GB)}}
```

- If `nvidia-smi` is "not recognized", you either don't have an NVIDIA GPU or its driver isn't installed. Version 1 needs an **NVIDIA** GPU.
- `nvidia-smi` shows the GPU name, its memory (for example `12288MiB` = 12 GB) and the driver version.

| GPU memory (VRAM) | What to expect with Wan 2.2 5B |
|---|---|
| under 8 GB | Below the minimum. Likely out-of-memory errors. |
| 8–11 GB | Should run with ComfyUI's automatic offloading, slowly. Start with **draft** sizes. |
| 12–15 GB | Native 720p clips should work. |
| 16 GB+ | Comfortable. |

You also want **32 GB of system RAM** (16 GB may work but slowly) and **~30 GB of free disk space**.

## Step 2 — Install ComfyUI (official portable build)

1. Go to the official releases page: <https://github.com/comfyanonymous/ComfyUI/releases> and download **ComfyUI_windows_portable_nvidia.7z** from the latest release.
2. Extract it with [7-Zip](https://www.7-zip.org/) to a short path, e.g. `C:\AI\ComfyUI_windows_portable`.
3. Double-click **`run_nvidia_gpu.bat`**. A browser tab opens at `http://127.0.0.1:8188`. Leave the black window open.

## Step 3 — Download the model (≈17 GB, Apache-2.0 license)

These are the exact files linked from ComfyUI's official *Wan 2.2 5B* template. Put each file in the folder shown, inside `ComfyUI_windows_portable\ComfyUI\models\`:

| File | Folder | Size |
|---|---|---|
| [wan2.2_ti2v_5B_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors) | `diffusion_models` | 9.3 GB |
| [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.3 GB |
| [wan2.2_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors) | `vae` | 1.3 GB |

Restart ComfyUI after copying them in.

**Test ComfyUI on its own first.** In the ComfyUI tab: *Workflow → Browse Templates → Video → "Wan 2.2 5B"*. Load any image, press **Run**, and wait. If a video comes out, your computer can do it, and the studio will work the same way. If you get an "out of memory" error, note your VRAM and tell me.

## Step 4 — Start the agent

1. Copy this whole `studio-agent` folder into `C:\AI\ComfyUI_windows_portable\studio-agent`.
2. Open PowerShell **in that folder** (in File Explorer, click the address bar, type `powershell`, press Enter) and run:
   ```powershell
   ..\python_embeded\python.exe agent.py --init --origin https://YOUR-SITE.vercel.app
   ```
   Use the address you open the website at. To list several, separate them with commas, e.g. a preview URL plus the real domain.
   This creates `config.json` and prints a long **secret**. Copy the secret. It's private: it never goes into git or a chat.
3. From now on, start the agent by double-clicking **`start-agent.bat`**. Keep ComfyUI running too.

Optional: install FFmpeg (`winget install Gyan.FFmpeg`) so the agent can fully verify every video it produces.

## Step 5 — Open a secure tunnel

The website needs an HTTPS address that reaches the agent.

**Quick test (no account needed):**
```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```
It prints an address like `https://something-random.trycloudflare.com`. That address changes every time you restart it, so it's fine for testing.

**Permanent option (free):** [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) gives a fixed `https://your-pc.your-tailnet.ts.net` address. Install Tailscale, sign in, then run `tailscale funnel 8787`. A Cloudflare *named* tunnel works too if your domain is on Cloudflare.

Point the tunnel **only** at port 8787 (the agent), never at 8188 (ComfyUI).

## Step 6 — Add four settings in Vercel

Vercel → your BLVCKDISK project → **Settings → Environment Variables**. Start with **Preview** only:

| Name | Value |
|---|---|
| `STUDIO_PASSWORD` | A long password you'll type to sign in (at least 12 characters; a passphrase is best) |
| `STUDIO_SESSION_SECRET` | A new random value. Generate one with `..\python_embeded\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `STUDIO_AGENT_URL` | The tunnel address from Step 5 |
| `STUDIO_AGENT_SECRET` | The secret printed in Step 4 |

Redeploy the preview, open `/studio`, and sign in. The dashboard should show your GPU and **Ready** next to both video modes.

## First real test (please do this and send me the result)

1. Create Video → Image → Video → upload a photo → choose **9:16 draft**, **2.0 s · 49 frames** → Generate.
2. Watch the queue show *Loading model → Generating frames (step x/20) → Decoding → Done*.
3. Play the result, then Download it.
4. Note how long it took (shown under the video) and your GPU.

Until this has run on your computer, **real generation is unverified**. Everything up to ComfyUI has been tested with a fake ComfyUI.

## Troubleshooting

| You see | Do this |
|---|---|
| "Studio not set up yet" | One of the four Vercel settings is missing or too short (the page shows which). |
| "Studio computer offline" | Is the agent window open? Is the tunnel running? Did the tunnel address change? |
| "Agent online · ComfyUI not running" | Start `run_nvidia_gpu.bat`. |
| "Needs setup — Model files not installed" | A model file is in the wrong folder or misnamed (Step 3). |
| "Update ComfyUI — missing nodes" | Run `update\update_comfyui.bat` in the ComfyUI folder. |
| "The GPU ran out of memory" | Use a draft size and fewer frames, and close games or other GPU apps. |
| Not authorised | Sign in again. Also check `STUDIO_AGENT_SECRET` in Vercel matches `secret` in `config.json`. |
| Browser blocks the request (CORS) | Add the exact website address to `allowed_origins` in `config.json`, then restart the agent. |

## For developers

- `agent.py` HTTP API + job store · `comfy.py` ComfyUI client (incl. websocket progress) · `workflows.py` model limits + graph (mirrors the official template).
- Tests (fake ComfyUI, no GPU): `python -m unittest discover -s tests`
- Token format is shared with `src/lib/studio/token.ts`. `tests/unit/studio.test.ts` checks that both sides agree.
