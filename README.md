# BLVCKDISK — blackdisk.co

Static site (no build step) plus one Vercel Function.

```
index.html, about/, services/, work/, start/   pages
style.css, site.js, favicon.svg, brand-study.jpg
api/inquiry.js                                  POST /api/inquiry → email to hello@blackdisk.co
vercel.json                                     trailingSlash: true (/about → /about/)
scripts/check.mjs                               site checks + tests   (npm run check)
scripts/verify-live.mjs                         compare repo with https://blackdisk.co (npm run verify:live)
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
