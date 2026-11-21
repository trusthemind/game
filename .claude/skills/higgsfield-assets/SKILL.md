---
name: higgsfield-assets
description: How to use the Higgsfield MCP tools in Ashfall (images, 3D, uploads, costs, provenance). Use before any generate_image / generate_3d / media_upload call.
---

# Higgsfield assets

The subscription and login belong to the user. Never bypass limits, filters or queues; if a call is refused or a filter trips, stop and tell them.

## Before generating
1. `balance` for credits and plan.
2. `get_cost: true` in `generate_3d` params (`estimate_image_cost` for images); state the cost and ask when it is above a few credits. Rough costs: sheet ~2, Tripo ~18, Meshy ultra ~44, SAM 3D Body ~1.
3. `models_explore(type:'3d')` for the model's roles/params; image-to-3D with `should_texture:true`.
4. At most 4 jobs in parallel (Starter limit). On a transport timeout do not resubmit: look the job up (`show_generations`, `jobs_wait`).

## Uploading our files
`media_upload` (filename with the right extension) -> `curl -X PUT --upload-file <file> "<upload_url>"` (expect HTTP 200) -> `media_confirm` (type image|file). Pass the returned media_id in `medias[].value`, never a URL. Web images: `media_import_url`.

## Downloading
Fetch results into `tools/assets/mpfb-pilot/refs/ai/` (`sheet_*`, `3d/`, `bodies/`; git-ignored, never shipped). Download only with the user's OK on filename/source/size.

## Provenance (always)
- Prompt + model + date + job/credits in `refs/ai/PROMPTS.md`.
- Subject JSON `provenance` block (`ai3d.mjs init` flags) and `apps/web/public/models/CREDITS.txt`.
- Higgsfield ToS 4.4 (outputs usable commercially); Hunyuan licence excludes EU/UK/KR.

## Content rules
Invented adults only, no real person or celebrity likeness, no explicit imagery, clothed or underwear-neutral references. Then continue with skill `ai3d-fit`.
