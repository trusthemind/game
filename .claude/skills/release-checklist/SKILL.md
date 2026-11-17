---
name: release-checklist
description: Pre-deploy checklist and rollback plan for Ashfall (Vercel web + Railway Go server, profile version compat). Use when the user says "деплой", "реліз", "на прод", or before any push to main.
---

# Release checklist

Deploy happens on push to main, so **never push without the user's explicit OK**. This skill only verifies and reports; it runs no deploy command.

## 1. Scope
- `git status`, `git log origin/main..HEAD --oneline`: what is going out? Note whether it touches `server/**` (Railway rebuilds only on `server/**`, see `server/railway.json` watchPatterns) and/or web (Vercel).

## 2. Gates (report the actual output, never assume)
- `npm run check` (typecheck, lint, test, build). Also `cd apps/web && npx tsc -b`, the same typecheck Vercel runs.
- `cd server && go vet ./... && go test ./...` if the server changed.
- `npm run e2e -w @ashfall/web` smoke if the UI/boot path changed.
- Vercel config: `vercel.json` (build `npm run build -w @ashfall/web`, output `apps/web/dist`). Build output size sane; model files are `public/models/*.glb`.

## 3. Compatibility
- Did `PROFILE_VERSION` (`packages/engine/src/profile.ts`) change? Then: migration exists, test loads an old profile, and a **client/server skew** is safe: old cached client (service worker, `sw.js`) talking to a new server and vice versa. Server must tolerate unknown/missing profile fields.
- API change in `server/internal/api`? Keep the old route/fields until clients refresh. Healthcheck `/api/v1/health` stays (Railway uses it).
- New assets: art-asset-intake done, CREDITS.txt updated.

## 4. Order
- Server first when the API is additive; web first when the web is backward compatible with the old server. State which applies.

## 5. After deploy (user confirms, or read-only checks)
- Health endpoint 200; open prod, start and extract a raid, reload, profile intact; console has no new errors; fps similar to before.

## 6. Rollback
- Web: Vercel dashboard, promote the previous deployment (instant). Server: Railway, redeploy the previous deployment. Code: `git revert <hash>` on a new commit; never force-push main.
- Profiles already migrated to a newer version cannot be read by an older client: if `PROFILE_VERSION` was bumped, rollback of the web alone is unsafe. Say this explicitly.

## Verdict
READY / NOT READY (blocker list) / NOT ASSESSED (what was not run). Update status in `plan.md` only if asked.
