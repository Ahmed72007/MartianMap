# MARSWALK · Interplanetary Survival Guide: Martian Map

NASA Space Apps 2026 · Challenge #10. Open **[index.html](index.html)** for the hub, or go straight to one of the two apps:

| File | What it is | Data |
|---|---|---|
| [`marswalk.html`](marswalk.html) | **Field Systems planner.** Single file, works offline. Plans multi-stop science traverses on the Jezero western delta, with slope-hazard avoidance, re-routing around reported obstructions, a suited-walking time budget, a visor HUD and a 3D astronaut view. | Real NASA/USGS products embedded: CTX imagery, 20 m CTX DEM + slope, THEMIS thermal inertia, CRISM D2300, USGS SIM 3464 geology, Perseverance MEDA |
| [`field-operations.html`](field-operations.html) | **Field Operations game.** Pick a landing cell on a global Mars map, descend, and explore on foot (keyboard/mouse or touch). | NASA Mars Trek global basemap. Site scores and telemetry are fictional and labelled *simulated*. |

Open either file in a recent Chrome, Edge, Firefox or Safari. The planner's 2D map, routing, HUD and data panels need no network; its 3D view and the game load three.js / Leaflet from jsDelivr.

### Planner workflow (≈1 minute)
1. **Set start** and click inside the dashed boundary, or press **Load demo traverse**.
2. Add stops: click crater points, use **Add stop**, or pick from the list (up to 8).
3. **Plan traverse.** An exact search over visiting orders runs on the 20 m grid. Cells above the slope threshold (default 15°) are impassable.
4. **Mark obstruction** anywhere and the traverse re-plans instantly, showing the distance/time penalty.
5. Open **Visor HUD** and press **Play traverse** (switch to **3D terrain → Astronaut eye** for a first-person view). Export JSON/GeoJSON or copy a share link.

The **Challenge coverage** button inside the planner maps each Challenge #10 objective to what is implemented, partial or not yet available.

### Editing the planner
Source lives in `system/src/` (`template.html`, `styles.css`, `app.js`). Rebuild the single file with:

```
python3 system/build.py
```

The build re-uses the data block already embedded in `marswalk.html`, so the ~11 MB dataset is stored once. The data was produced by the MARSWALK Python pipeline in the team's development repository (React + FastAPI + NASA/USGS preprocessing).

Tests (Playwright, Chromium):
```
node system/tests/smoke.spec.cjs
node system/tests/game.spec.cjs
```

## Deploying on Vercel
The site is plain static HTML with no build step. `vercel.json` sets `framework: null` and empty build/install commands, and the output directory is the repo root. Import the repository in Vercel and keep the defaults, or run `vercel --prod`. `cleanUrls` serves `/marswalk` and `/field-operations`. `.vercelignore` keeps the source and tests out of the deployment.
