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

1. Upload a photo.
2. Change the settings. The preview updates by itself.
   - **Result**: what the laser will burn. **Wood colors** shows it in wood colors.
   - **Gray tones**: the picture before it is turned into dots.
   - **Face areas**: shows which parts were found as eyes, hair, skin and so on.
3. Click **Export laser files**. The files are also saved in `output/`.

## Files

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
