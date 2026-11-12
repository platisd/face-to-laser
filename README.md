# Face to laser

Turns a photo of a face into files for a laser engraver (made for the Creality Falcon A1, works with others too).

## Start

1. Open this folder in VS Code and choose **Reopen in Container**.
2. In the container terminal run:

   ```
   python -m face_to_laser.app
   ```

3. Open http://localhost:7860 in your browser.

The first photo takes longer because the models are downloaded (about 180 MB) into `models/`.

## Use

1. Open the page. The first time, it downloads three models (about 200 MB, most of it the background removal model). After that they come from the browser cache.
2. Choose a photo (or drop or paste it).
3. Change the settings. The preview updates by itself.
   - **Result**: what the laser will burn. **Wood colors** shows it in wood colors.
   - **Gray tones**: the picture before it is turned into dots.
   - **Face areas**: shows which parts were found as eyes, hair, skin and so on.
3. Click **Export laser files**. The files are also saved in `output/`.

The page remembers your last settings. **Save settings** and **Load settings** use a `.json` file.

## Files in the .zip

| File | What it is |
|---|---|
| `*_combined.svg` | Picture and cut line in one file, at the right size. Try this first. |
| `*_engrave.png` | Only the picture. Black dots = burn. Has the dots per inch inside, so it opens at the right size. |
| `*_cut.svg`, `*_cut.dxf` | Only the cut line, as a red line. Same size and position as the picture. |
| `*_settings.json` | The settings used. Load it again with **Load settings**. |

In Falcon Design Space: set the picture to **engrave** and the red line to **cut**. The speed and power for your material are set there, not here.

## Tests

```
python -m pytest
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

Models, all downloaded by the page at fixed versions and kept in the browser cache:

- Background removal: U²-Net (`u2net`, Apache 2.0), from Hugging Face.
- Face points: MediaPipe face landmarker (Apache 2.0), from Google's model storage.
- Face areas: MediaPipe selfie multiclass segmenter (Apache 2.0), from Google's model storage.

The first version was written in Python (commit `fdd84f5`).
