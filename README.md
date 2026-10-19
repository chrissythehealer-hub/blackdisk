# BLVCKDISK — blackdisk.co

Static site (no build step) plus one Vercel Function.

```
index.html, about/, services/, work/, start/   pages
style.css, site.js, favicon.svg, brand-study.jpg
api/inquiry.js                                  POST /api/inquiry → email to hello@blackdisk.co
vercel.json                                     trailingSlash: true (/about → /about/)
scripts/check.mjs                               site checks + tests   (npm run check)
scripts/verify-live.mjs                         compare repo with https://blackdisk.co (npm run verify:live)
scripts/preview.mjs                             local preview on :4173 (npm run preview; inquiry is stubbed)
studio/                                         AI Studio page (/studio/)
studio-agent/                                   Kaggle notebook builder + ComfyUI/Wan 2.2 workflow code (not served)
```

## Where this source came from

Production (blackdisk.co) is deployed to Vercel directly, not from this repository.
The pages and assets here were recovered from the live site and verified byte-for-byte
with `npm run verify:live` (Cloudflare's email obfuscation is decoded before comparing).

**`api/inquiry.js` and `vercel.json` are reconstructions.** The Vercel project serving
blackdisk.co was not reachable through the Vercel connector, so their exact source could not
be downloaded. They reproduce the behaviour observed on the live site (405 + `Allow: POST`
for GET, 308 trailing-slash redirects) and the contract `site.js` depends on. Replace them
with the deployed originals (Vercel → Deployments → latest production → Source) before
connecting this repository to the production project.

## Environment variables (names only — never commit values; this repo is public)

| Name | Used by | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | `api/inquiry.js` | Required. Email provider API key. |
| `INQUIRY_TO` | `api/inquiry.js` | Optional, defaults to hello@blackdisk.co. |
| `INQUIRY_FROM` | `api/inquiry.js` | Sender on a domain verified with the provider. |

These are the names the reconstruction uses; confirm them against the production project's
Environment Variables page.

## AI Studio (`/studio/`)

A public gallery of real clips rendered with **Wan 2.2 TI2V-5B** (Apache-2.0) in ComfyUI on
Kaggle's free T4, plus a Create panel that prepares a Kaggle notebook in the browser.
No login, no server calls, no GPU of our own: **$0**.

### Publish a clip

1. Run the notebook on Kaggle (Create panel → *Download Kaggle notebook*, or
   `studio-agent/kaggle/wan22_first_video.ipynb`). Step 8 prints the clip's gallery entry.
2. Put the MP4 in `studio/videos/<id>.mp4` (keep it small; draft clips are ~1–3 MB).
3. Add the entry to `studio/gallery.json`, then `npm run build:studio` and `npm run check`.

A clip whose MP4 isn't in `studio/videos/` yet is shown as "Video file not yet published"
rather than a broken player.

### Changing the notebook

Edit `studio-agent/comfy.py`, `workflows.py` or `kaggle/build_notebook.py`, then
`python3 studio-agent/kaggle/build_notebook.py && npm run build:studio`. The Create panel
rewrites the `MODE`/`IMAGE_URL`/`PROMPT`/`SIZE`/`FRAMES`/`STEPS`/`SEED` lines of step 5, and
`npm run check` fails if that cell or the published copy goes missing or stale.

### Live generation — OFF

On-site generation is not built. It would need an always-on GPU, which isn't free. If it is
ever enabled, these come first, server-side, before the endpoint goes public:

- Cloudflare Turnstile on every generation request (verify the token on the server).
- Per-visitor limits (per IP and per Turnstile session) and a global daily cap.
- A kill switch, prompt length limits, and no direct exposure of ComfyUI (127.0.0.1 only).
