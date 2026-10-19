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
