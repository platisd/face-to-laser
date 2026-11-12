# face-to-laser

Photo. Preview. Beautify. Burn. 🔥

## What?

`face-to-laser` turns a photo of a face into files for a laser engraver.
It is made for the Creality Falcon family, but works with other laser engravers too.

It runs fully in the browser: **https://platisd.github.io/face-to-laser/**<br>
Your photo never leaves your computer. There is no server.

You get a picture to **engrave** and, if you want, a line to **cut** the piece out around the person.

## Why?

Turning a photo into something a laser can burn usually takes many manual steps:
Remove the background, fix the lighting and contrast, turn the picture into dots, and draw a cut line.<br>
`face-to-laser` does all of them in one page, with a live preview, so you can see the result before you burn anything.

## How?

1. Open the page. The first time, it downloads some models. After that they come from the browser cache.
2. Choose a photo (or drop or paste it).
3. Change the settings. The preview updates by itself.
4. Click **Export laser files**. You get one `.zip` file.

The page remembers your last settings.<br>
**Save settings** and **Load settings** use a `.json` file.

The `.zip` file contains:

| File                     | What it is                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `*_combined.svg`         | Picture and cut line in one file, at the right size. Try this first.                              |
| `*_engrave.png`          | Only the picture. Black dots = burn. Has the dots per inch inside, so it opens at the right size. |
| `*_cut.svg`, `*_cut.dxf` | Only the cut line, as a red line. Same size and position as the picture.                          |
| `*_settings.json`        | The settings used. Load it again with **Load settings**.                                          |

In Falcon Design Space: set the picture to **engrave** and the red line to **cut**.
The speed and power for your material are set there, not here.

### Software

- A recent desktop browser
- `face-to-laser` code (this [repository](https://github.com/platisd/face-to-laser))
- Models, downloaded by the page and kept in the browser cache:
  - [U²-Net](https://github.com/xuebinqin/U-2-Net) to remove the background
  - [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/guide) to find the face and the face areas (eyes, hair, skin, ...)
- Libraries:
  - [OpenCV.js](https://github.com/TechStark/opencv-js) for the image steps
  - [ONNX Runtime Web](https://onnxruntime.ai/) to run U²-Net
  - [JSZip](https://stuk.github.io/jszip/) to make the `.zip` file

### Hardware

- A laser engraver (e.g. Creality Falcon)
- Wood or another material to burn
