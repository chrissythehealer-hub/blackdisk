"""
Generation workflows the studio can run. Each workflow declares exactly what the model
supports; the website builds its controls from this, so it never offers a setting the model
cannot produce.

Wan 2.2 TI2V-5B
  - Weights: Apache-2.0 (Wan-AI/Wan2.2-TI2V-5B). Text encoder umt5-xxl: Apache-2.0.
  - Files (ComfyUI repackage, linked from ComfyUI's official template "video_wan2_2_5B_ti2v"):
      models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors   (9.31 GB)
      models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors (6.27 GB)
      models/vae/wan2.2_vae.safetensors                          (1.31 GB)
  - Native output: 1280×704 or 704×1280, 24 fps, up to 121 frames (≈5 s) per clip.
    Graph and defaults mirror the official template (20 steps, CFG 5, uni_pc/simple, shift 8).
"""
from __future__ import annotations

# Wan's recommended negative prompt (as shipped in the official ComfyUI template).
WAN_DEFAULT_NEGATIVE = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，"
    "多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走"
)

WAN22_FILES = {
    "diffusion_models": "wan2.2_ti2v_5B_fp16.safetensors",
    "text_encoders": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "vae": "wan2.2_vae.safetensors",
}

# Every size is a multiple of 32 (the latent node's step). "native" = the resolution the model was trained for.
WAN22_SIZES = [
    {"id": "16x9", "aspect": "16:9", "width": 1280, "height": 704, "label": "16:9 · 1280×704 (native 720p)", "native": True},
    {"id": "9x16", "aspect": "9:16", "width": 704, "height": 1280, "label": "9:16 · 704×1280 (native 720p)", "native": True},
    {"id": "1x1", "aspect": "1:1", "width": 960, "height": 960, "label": "1:1 · 960×960 (non-native, experimental)", "native": False},
    {"id": "4x5", "aspect": "4:5", "width": 832, "height": 1024, "label": "4:5 · 832×1024 (non-native, experimental)", "native": False},
    {"id": "16x9-draft", "aspect": "16:9", "width": 832, "height": 480, "label": "16:9 · 832×480 draft (faster, lower quality)", "native": False},
    {"id": "9x16-draft", "aspect": "9:16", "width": 480, "height": 832, "label": "9:16 · 480×832 draft (faster, lower quality)", "native": False},
]

WORKFLOWS = {
    "wan22-i2v": {
        "id": "wan22-i2v",
        "kind": "image-to-video",
        "label": "Image → Video · Wan 2.2 TI2V 5B",
        "model": "Wan 2.2 TI2V 5B",
        "license": "Apache-2.0",
        "requires_image": True,
        "files": WAN22_FILES,
        "nodes": ["UNETLoader", "CLIPLoader", "VAELoader", "ModelSamplingSD3", "Wan22ImageToVideoLatent", "KSampler", "VAEDecode", "CreateVideo", "SaveVideo"],
    },
    "wan22-t2v": {
        "id": "wan22-t2v",
        "kind": "text-to-video",
        "label": "Text → Video · Wan 2.2 TI2V 5B",
        "model": "Wan 2.2 TI2V 5B",
        "license": "Apache-2.0",
        "requires_image": False,
        "files": WAN22_FILES,
        "nodes": ["UNETLoader", "CLIPLoader", "VAELoader", "ModelSamplingSD3", "Wan22ImageToVideoLatent", "KSampler", "VAEDecode", "CreateVideo", "SaveVideo"],
    },
}

WAN22_LIMITS = {
    "sizes": WAN22_SIZES,
    "fps": 24,
    "frames": {"min": 25, "max": 121, "step": 4, "default": 121},  # 4n+1 frames
    "steps": {"min": 8, "max": 50, "default": 20},
    "cfg": {"min": 1.0, "max": 10.0, "default": 5.0},
    "prompt_max": 2000,
    "negative_default": WAN_DEFAULT_NEGATIVE,
    "output": "mp4",
}

SEED_MAX = 2**63 - 1


class ValidationError(ValueError):
    pass


def validate_params(workflow_id: str, raw: dict) -> dict:
    """Checks a job request against what the workflow really supports. Returns clean params."""
    if workflow_id not in WORKFLOWS:
        raise ValidationError("Unknown workflow.")
    lim = WAN22_LIMITS
    prompt = str(raw.get("prompt") or "").strip()
    if not prompt:
        raise ValidationError("Write a prompt describing the motion or scene.")
    if len(prompt) > lim["prompt_max"]:
        raise ValidationError(f"Prompt is too long (max {lim['prompt_max']} characters).")
    negative = str(raw.get("negative") if raw.get("negative") is not None else lim["negative_default"]).strip()[: lim["prompt_max"]]

    size = next((s for s in lim["sizes"] if s["id"] == raw.get("size")), None)
    if not size:
        raise ValidationError("Choose one of the supported sizes.")

    def num(key, kind, rng):
        try:
            v = kind(raw.get(key, rng["default"]))
        except (TypeError, ValueError):
            raise ValidationError(f"{key} must be a number.") from None
        if not (rng["min"] <= v <= rng["max"]):
            raise ValidationError(f"{key} must be between {rng['min']} and {rng['max']}.")
        return v

    frames = num("frames", int, lim["frames"])
    if (frames - 1) % 4:
        raise ValidationError("Frame count must be 4n+1 (e.g. 49, 81, 121).")
    steps = num("steps", int, lim["steps"])
    cfg = round(num("cfg", float, lim["cfg"]), 2)

    seed = raw.get("seed")
    if seed in (None, "", -1, "-1"):
        import secrets
        seed = secrets.randbelow(SEED_MAX)
    try:
        seed = int(seed)
    except (TypeError, ValueError):
        raise ValidationError("Seed must be a whole number.") from None
    if not (0 <= seed <= SEED_MAX):
        raise ValidationError("Seed is out of range.")

    return {
        "prompt": prompt,
        "negative": negative,
        "size": size["id"],
        "width": size["width"],
        "height": size["height"],
        "frames": frames,
        "fps": lim["fps"],
        "steps": steps,
        "cfg": cfg,
        "seed": seed,
        "duration_s": round(frames / lim["fps"], 2),
    }


def build_graph(workflow_id: str, p: dict, image_name: str | None, filename_prefix: str) -> dict:
    """ComfyUI API-format graph, node-for-node the official Wan 2.2 5B TI2V template."""
    f = WORKFLOWS[workflow_id]["files"]
    latent = {"vae": ["39", 0], "width": p["width"], "height": p["height"], "length": p["frames"], "batch_size": 1}
    graph = {
        "37": {"class_type": "UNETLoader", "inputs": {"unet_name": f["diffusion_models"], "weight_dtype": "default"}},
        "38": {"class_type": "CLIPLoader", "inputs": {"clip_name": f["text_encoders"], "type": "wan", "device": "default"}},
        "39": {"class_type": "VAELoader", "inputs": {"vae_name": f["vae"]}},
        "48": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["37", 0], "shift": 8.0}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": p["prompt"], "clip": ["38", 0]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": p["negative"], "clip": ["38", 0]}},
        "55": {"class_type": "Wan22ImageToVideoLatent", "inputs": latent},
        "3": {"class_type": "KSampler", "inputs": {
            "seed": p["seed"], "steps": p["steps"], "cfg": p["cfg"], "sampler_name": "uni_pc", "scheduler": "simple", "denoise": 1.0,
            "model": ["48", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["55", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["39", 0]}},
        "57": {"class_type": "CreateVideo", "inputs": {"images": ["8", 0], "fps": float(p["fps"])}},
        # Newer ComfyUI keys the nested codec as "format.codec"; older builds use "codec". Unused keys are ignored.
        "58": {"class_type": "SaveVideo", "inputs": {"video": ["57", 0], "filename_prefix": filename_prefix, "format": "mp4", "codec": "auto", "format.codec": "auto"}},
    }
    if WORKFLOWS[workflow_id]["requires_image"]:
        if not image_name:
            raise ValidationError("Upload a reference image first.")
        graph["56"] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
        latent["start_image"] = ["56", 0]
    return graph


STAGE_BY_NODE = {"3": "Generating frames", "8": "Decoding video", "58": "Saving video", "37": "Loading model", "38": "Loading text encoder", "39": "Loading VAE"}


def hardware_guidance(vram_gb: float | None, device_type: str | None) -> dict:
    """Plain-language fit for Wan 2.2 5B. Based on ComfyUI's note that the 5B model runs on 8 GB with offloading."""
    if vram_gb is None:
        return {"level": "unknown", "text": "GPU not detected yet. Start ComfyUI so the studio can read your hardware."}
    if device_type and device_type != "cuda":
        return {"level": "unsupported", "text": f"Detected a {device_type} device. Version 1 is set up and tested for NVIDIA (CUDA) GPUs only."}
    if vram_gb < 7.5:
        return {"level": "poor", "text": f"{vram_gb:.0f} GB VRAM is below what Wan 2.2 5B needs. Expect out-of-memory errors; use draft sizes and short clips."}
    if vram_gb < 11.5:
        return {"level": "tight", "text": f"{vram_gb:.0f} GB VRAM: should run with ComfyUI's automatic offloading, slowly. Start with draft sizes and 49–81 frames."}
    if vram_gb < 15.5:
        return {"level": "ok", "text": f"{vram_gb:.0f} GB VRAM: native 720p should work; full 121-frame clips will take a while."}
    return {"level": "good", "text": f"{vram_gb:.0f} GB VRAM: comfortable for native 720p clips."}
