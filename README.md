# Face to laser

Turns a photo of a face into files for a laser engraver (made for the Creality Falcon A1, works with others too).

It runs fully in the browser: **https://platisd.github.io/face-to-laser/**

Your photo never leaves your computer. There is no server.

## Use

1. Open the page. The first time, it downloads two models (about 20 MB). After that they come from the browser cache.
2. Choose a photo (or drop or paste it).
3. Change the settings. The preview updates by itself.
   - **Result**: what the laser will burn. **Wood colors** shows it in wood colors.
   - **Gray tones**: the picture before it is turned into dots.
   - **Face areas**: shows which parts were found as eyes, hair, skin and so on.
4. Click **Export laser files**. You get one `.zip` file.

The page remembers your last settings. **Save settings** and **Load settings** use a `.json` file
(the same format as the old Python version).

## Files in the .zip

| File | What it is |
|---|---|
| `*_combined.svg` | Picture and cut line in one file, at the right size. Try this first. |
| `*_engrave.png` | Only the picture. Black dots = burn. Has the dots per inch inside, so it opens at the right size. |
| `*_cut.svg`, `*_cut.dxf` | Only the cut line, as a red line. Same size and position as the picture. |
| `*_settings.json` | The settings used. Load it again with **Load settings**. |

In Falcon Design Space: set the picture to **engrave** and the red line to **cut**. The speed and power for your material are set there, not here.

## Develop

Needs Node.js 22 (or open the folder in VS Code and choose **Reopen in Container**).

```
npm ci
npm run dev        # page at http://localhost:5173/face-to-laser/
npm test           # image steps, settings, exports
npm run test:ui    # one Playwright test of the whole page (uses Chrome)
npm run build      # files for GitHub Pages in dist/
```

Every push to `main` or `master` runs the tests and publishes to GitHub Pages
(`.github/workflows/pages.yml`).

## How it works

| File | What it does |
|---|---|
| `src/settings.ts` | Settings, defaults, save/load JSON. |
| `src/controls.ts` | The list of all controls, and which ones are in use. |
| `src/models.ts`, `src/partFinders.ts` | Download the MediaPipe models (with cache and progress) and run them. |
| `src/analysis.ts` | Run once per photo: person shape, crop, face areas. |
| `src/imageSteps.ts`, `src/bilateral.ts` | Even lighting, tone, dots, stencil. |
| `src/outlines.ts` | Solid shape, grow, smooth, biggest piece, cut line in mm. |
| `src/laserJob.ts` | Puts the steps together. |
| `src/preview.ts` | Preview pictures. |
| `src/exportFiles.ts` | PNG with DPI, SVG, DXF, settings JSON, zip. |
| `src/worker.ts` | Does the heavy work off the page, so it does not freeze. |
| `src/ui.ts` | The page. |

Models: MediaPipe face landmarker and selfie multiclass segmenter (Apache 2.0), downloaded from Google's model storage at fixed versions.
The person shape comes from the segmenter, so no separate background removal model is needed.

The first version was written in Python (commit `fdd84f5`).
