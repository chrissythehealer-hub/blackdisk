# BLVCKDISK — blackdisk.co

Static site (no build step) plus one Vercel Function. Layout matches the production
deployment exactly.

```
dist/                     everything served (vercel.json: outputDirectory "dist")
  index.html, about/, services/, work/, start/
  style.css, site.js, favicon.svg, brand-study.jpg
api/inquiry.mjs           POST /api/inquiry → email to hello@blackdisk.co via Resend
vercel.json               cleanUrls + trailingSlash (/about → /about/)
scripts/check.mjs         site checks + tests        (npm run check)
scripts/verify-live.mjs   compare dist/ with https://blackdisk.co (npm run verify:live)
scripts/preview.mjs       local preview on :4173     (npm run preview; inquiry is stubbed)
scripts/build-studio.mjs  render the studio gallery  (npm run build:studio)
dist/studio/              AI Studio page (/studio/)
studio-agent/             Kaggle notebook builder + ComfyUI/Wan 2.2 workflow code (not served)
```

## Where this source came from

Recovered from production deployment `dpl_2fXy8awdkr7zkwRGyYM8Za1PTcCm` of the Vercel
project `blackdisk` (the one serving blackdisk.co).

- **Exact (SHA-1 identical to the deployment's files):** `vercel.json` and every file in `dist/`.
  `npm run verify:live` also matches the live site (Cloudflare's email obfuscation is decoded first).
- **Partly reconstructed: `api/inquiry.mjs`.** The opening (constants, spam limits, helpers) is
  verbatim; the connector truncated the rest, which is rebuilt from the contract `site.js` uses.
  The file says exactly where the recovered part ends. Replace it with the original
  (Vercel → blackdisk → that deployment → Source → `api/inquiry.mjs`) before production.

## Deploying

The GitHub repo is linked to the Vercel project: **a push to `main` builds a production
deployment.** Branch pushes build preview deployments only. Merge to `main` only with approval.

## Environment variables (names only — never commit values; this repo is public)

| Name | Used by | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | `api/inquiry.mjs` | Required. Resend API key (server-only). |
| `INQUIRY_FROM_EMAIL` | `api/inquiry.mjs` | Required. Sender on a domain verified in Resend, e.g. `BLACKDISK Website <inquiries@blackdisk.co>`. |

Names are from the original function's header comment. The recipient is fixed in code
(hello@blackdisk.co), never taken from the request.

## AI Studio (`/studio/`)

A public gallery of real clips rendered with **Wan 2.2 TI2V-5B** (Apache-2.0) in ComfyUI on
Kaggle's free T4, plus a Create panel that prepares a Kaggle notebook in the browser.
No login, no server calls, no GPU of our own: **$0**.

### Publish a clip

1. Run the notebook on Kaggle (Create panel → *Download Kaggle notebook*, or
   `studio-agent/kaggle/wan22_first_video.ipynb`). Step 8 prints the clip's gallery entry.
2. Put the MP4 in `dist/studio/videos/<id>.mp4` (keep it small; draft clips are ~1–3 MB).
3. Add the entry to `dist/studio/gallery.json`, then `npm run build:studio` and `npm run check`.

A clip whose MP4 isn't in `dist/studio/videos/` yet is shown as "Video file not yet published"
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
