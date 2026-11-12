import os
import urllib.request
from functools import cache
from pathlib import Path

MODELS_FOLDER = Path(__file__).resolve().parent.parent / "models"

FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
)
BODY_PARTS_SEGMENTER_URL = (
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/"
    "selfie_multiclass_256x256.tflite"
)
BACKGROUND_REMOVER_MODEL = "u2net"


def download_once(url: str) -> Path:
    target = MODELS_FOLDER / url.rsplit("/", 1)[-1]
    if not target.exists():
        MODELS_FOLDER.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        urllib.request.urlretrieve(url, partial)
        partial.rename(target)
    return target


@cache
def face_landmarker():
    from mediapipe.tasks.python import BaseOptions, vision

    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(download_once(FACE_LANDMARKER_URL))),
        num_faces=1,
    )
    return vision.FaceLandmarker.create_from_options(options)


@cache
def body_parts_segmenter():
    from mediapipe.tasks.python import BaseOptions, vision

    options = vision.ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=str(download_once(BODY_PARTS_SEGMENTER_URL))),
        output_confidence_masks=True,
        output_category_mask=False,
    )
    return vision.ImageSegmenter.create_from_options(options)


@cache
def background_remover():
    os.environ.setdefault("U2NET_HOME", str(MODELS_FOLDER / "rembg"))
    from rembg import new_session

    return new_session(BACKGROUND_REMOVER_MODEL)
