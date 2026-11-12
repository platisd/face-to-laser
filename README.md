# Face to laser

Turns a photo of a face into files for a laser engraver (made for the Creality Falcon, works with others too).

It runs fully in the browser: **https://platisd.github.io/face-to-laser/**

Your photo never leaves your computer. There is no server.

## Use

1. Open the page. The first time, it downloads some models. After that they come from the browser cache.
2. Choose a photo (or drop or paste it).
3. Change the settings. The preview updates by itself.
4. Click **Export laser files**. You get one `.zip` file.

The page remembers your last settings. **Save settings** and **Load settings** use a `.json` file.

## Files in the .zip

| File                     | What it is                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `*_combined.svg`         | Picture and cut line in one file, at the right size. Try this first.                              |
| `*_engrave.png`          | Only the picture. Black dots = burn. Has the dots per inch inside, so it opens at the right size. |
| `*_cut.svg`, `*_cut.dxf` | Only the cut line, as a red line. Same size and position as the picture.                          |
| `*_settings.json`        | The settings used. Load it again with **Load settings**.                                          |

In Falcon Design Space: set the picture to **engrave** and the red line to **cut**.
The speed and power for your material are set there, not here.
