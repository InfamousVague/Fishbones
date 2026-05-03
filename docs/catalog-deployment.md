# Catalog deployment

Fishbones now ships with a small **core** set of bundled courses (Rust Book, Learning Go, all 13 challenge packs) and treats every other book as a **remote** placeholder the user installs on demand.

This doc covers the server side: what files to host, where, and how the client finds them.

---

## What needs to be hosted

After running `npm run build:web` (or `npm run starter:web` standalone) you'll have a populated `public/starter-courses/` directory:

```
public/starter-courses/
├── manifest.json                          ← the catalog
├── the-rust-programming-language.json     ← per-course bodies
├── learning-go.json
├── mastering-ethereum.json
├── ...                                    (one per course)
├── the-rust-programming-language.jpg      ← cover thumbnails (480px JPEG)
├── ...
```

**Plus** the original `.fishbones` archives in `src-tauri/resources/bundled-packs/` (47 files, ~145 MB total). The desktop app downloads these directly when a user clicks Install on a remote placeholder.

You need **two upload buckets** (or one with two prefixes):

| Path | Contents | Size | Purpose |
|---|---|---|---|
| `https://mattssoftware.com/fishbones/catalog/manifest.json` | Manifest JSON | ~30 KB | Desktop catalog fetch |
| `https://mattssoftware.com/fishbones/catalog/<id>.jpg` | Cover thumbnails | ~1 MB total | Desktop placeholder cover lookup |
| `https://mattssoftware.com/fishbones/courses/<id>.fishbones` | Original .fishbones archives | ~145 MB total | Desktop install download |

Web build uses same-origin paths under `/starter-courses/` — no remote hosting needed for web users; these CDN paths are desktop-only.

---

## URL configuration

The default catalog URL is **`https://mattssoftware.com/fishbones/catalog/manifest.json`** (web build uses same-origin instead — `/<base>/starter-courses/manifest.json`).

Override at build time:

```bash
# At extract-time, sets the per-course archiveUrl in the manifest
FISHBONES_CATALOG_BASE_URL=https://your-cdn.example.com/fishbones/courses npm run starter:web

# At runtime (Vite env), overrides where the app FETCHES the catalog from
FISHBONES_CATALOG_URL=https://your-cdn.example.com/fishbones/catalog/manifest.json npm run build
```

Both vars accept any HTTPS URL. The app refuses to download from non-HTTPS (the Rust command guards on the `archive_url` prefix).

---

## Upload workflow

The simplest path: a single `aws s3 sync` (or equivalent for your provider).

```bash
# After `npm run build:web` finishes…

# Catalog + per-course JSON + covers (~16 MB)
aws s3 sync public/starter-courses/ s3://your-bucket/fishbones/catalog/ \
  --acl public-read \
  --cache-control "public, max-age=300"

# .fishbones archives (~145 MB; only changes when you re-pack a course)
aws s3 sync src-tauri/resources/bundled-packs/ s3://your-bucket/fishbones/courses/ \
  --acl public-read \
  --cache-control "public, max-age=86400" \
  --exclude "README.md"
```

CloudFront / Cloudflare in front of the bucket is recommended — saves bandwidth and gives you Brotli on the JSON.

For Cloudflare Pages / Workers / R2, the equivalent is `wrangler r2 object put` per file or a one-shot upload via their dashboard. Same files, same paths.

---

## CSP

Tauri's CSP `connect-src` and `img-src` allow `https://mattssoftware.com` by default (see `src-tauri/tauri.conf.json`). If you point the catalog at a different host, add it to both:

```json
"csp": "... connect-src ... https://your-cdn.example.com; img-src ... https://your-cdn.example.com ..."
```

Otherwise the desktop app's catalog fetch + cover image loads will be blocked.

---

## Adding a new bundled book

1. Drop the `.fishbones` archive into `src-tauri/resources/bundled-packs/`
2. Add the id to `ALL_PACK_IDS` in `scripts/course-tiers.mjs`
3. **If core** (always installed): also add to `CORE_PACK_IDS` AND add the matching `resources/bundled-packs/<id>.fishbones` line to `tauri.conf.json` `resources`
4. Run `npm run starter:web` to regenerate the manifest
5. Re-upload (`s3 sync` again) — only the new files will transfer

The client picks up the new entry automatically on the next library mount (catalog cache TTL is 5 minutes).

---

## Rolling out an update to an existing book

1. Re-pack the `.fishbones` (e.g. via the in-app verifier's "Promote to bundled")
2. Run `npm run starter:web`
3. Upload new `manifest.json` + `<id>.json` + `<id>.fishbones`

Users who already have it installed will see the **update available** badge on the cover (the `bundleSha` comparison from the earlier work). One click reapplies.

---

## Bandwidth + cost notes

- Manifest + covers: ~16 MB. Updates roughly weekly. Cache 5 min on the client; CloudFront/Cloudflare cache 1 day.
- Archives: ~145 MB total. Each user pulls only the books they install (median ~3 archives, ~10 MB).
- Estimated cost @ 10K monthly users on AWS S3 + CloudFront: ~$5/mo data transfer.

If hosting cost becomes an issue, swap to:
- **Cloudflare R2** — zero egress fees
- **GitHub Releases** — host `.fishbones` archives as release assets, free public bandwidth (point `FISHBONES_CATALOG_BASE_URL` at the release URL)
