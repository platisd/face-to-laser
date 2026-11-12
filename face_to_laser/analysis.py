from dataclasses import dataclass

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageOps
from rembg import remove

from face_to_laser.model_files import background_remover, body_parts_segmenter, face_landmarker

PHOTO_MAX_SIDE = 3000
AREA_MAP_MAX_SIDE = 1024

SEGMENTER_HAIR = 1
SEGMENTER_BODY_SKIN = 2
SEGMENTER_FACE_SKIN = 3
SEGMENTER_CLOTHES = 4
SEGMENTER_OTHER = 5


@dataclass
class PhotoAnalysis:
    rgb: np.ndarray
    person: np.ndarray
    areas: dict[str, np.ndarray]
    message: str


def analyze_photo(photo: Image.Image) -> PhotoAnalysis:
    photo = ImageOps.exif_transpose(photo)
    photo = photo.convert("RGBA")
    on_white = Image.alpha_composite(Image.new("RGBA", photo.size, "white"), photo).convert("RGB")
    rgb = np.array(on_white)
    visible = np.array(photo.getchannel("A"), dtype=np.float32) / 255

    person_mask = remove(on_white, session=background_remover(), only_mask=True)
    person = np.array(person_mask, dtype=np.float32) / 255 * visible
    messages = ["Removed the background."]

    rgb, person = crop_to_person(rgb, person)
    rgb, person = shrink_to_max_side(rgb, person, PHOTO_MAX_SIDE)

    area_scale = min(1.0, AREA_MAP_MAX_SIDE / max(rgb.shape[:2]))
    small_rgb = cv2.resize(rgb, None, fx=area_scale, fy=area_scale, interpolation=cv2.INTER_AREA)
    areas, face_found = find_areas(small_rgb)
    if not face_found:
        messages.append("No face found: eyes, eyebrows, nose, mouth and face edge are not used.")
    return PhotoAnalysis(rgb=rgb, person=person, areas=areas, message=" ".join(messages))


def crop_to_person(rgb: np.ndarray, person: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rows, cols = np.nonzero(person > 0.5)
    if len(rows) == 0:
        return rgb, np.ones_like(person)
    top, bottom, left, right = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    return rgb[top:bottom, left:right].copy(), person[top:bottom, left:right].copy()


def shrink_to_max_side(rgb: np.ndarray, person: np.ndarray, max_side: int) -> tuple[np.ndarray, np.ndarray]:
    scale = max_side / max(rgb.shape[:2])
    if scale >= 1:
        return rgb, person
    return (
        cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
        cv2.resize(person, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
    )


def find_areas(rgb: np.ndarray) -> tuple[dict[str, np.ndarray], bool]:
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    body_parts = [mask.numpy_view().reshape(rgb.shape[:2]).astype(np.float32) for mask in body_parts_segmenter().segment(mp_image).confidence_masks]
    face_points = face_landmarker().detect(mp_image).face_landmarks

    height, width = rgb.shape[:2]
    features = face_feature_areas(face_points[0], width, height) if face_points else {}
    features_total = np.clip(sum(features.values(), np.zeros((height, width), np.float32)), 0, 1)
    rest = 1 - features_total

    areas = dict(features)
    areas["hair"] = body_parts[SEGMENTER_HAIR] * rest
    areas["skin"] = (body_parts[SEGMENTER_FACE_SKIN] + body_parts[SEGMENTER_BODY_SKIN]) * rest
    areas["clothes"] = (body_parts[SEGMENTER_CLOTHES] + body_parts[SEGMENTER_OTHER]) * rest
    return areas, bool(face_points)


def face_feature_areas(landmarks, width: int, height: int) -> dict[str, np.ndarray]:
    from mediapipe.tasks.python.vision import FaceLandmarksConnections as parts

    points = np.array([(point.x * width, point.y * height) for point in landmarks], dtype=np.float32)
    face_oval = point_indices(parts.FACE_LANDMARKS_FACE_OVAL)
    face_width = float(np.ptp(points[face_oval, 0]))

    def filled(connection_groups, grow_fraction):
        mask = np.zeros((height, width), np.float32)
        for connections in connection_groups:
            hull = cv2.convexHull(points[point_indices(connections)].astype(np.int32))
            cv2.fillConvexPoly(mask, hull, 1.0)
        return grow_softly(mask, grow_fraction * face_width)

    face_edge = np.zeros((height, width), np.float32)
    for connection in parts.FACE_LANDMARKS_FACE_OVAL:
        start, end = points[connection.start].astype(int), points[connection.end].astype(int)
        cv2.line(face_edge, tuple(start), tuple(end), 1.0, thickness=max(1, round(0.04 * face_width)))

    features = {
        "eyes": filled(
            [parts.FACE_LANDMARKS_LEFT_EYE, parts.FACE_LANDMARKS_RIGHT_EYE,
             parts.FACE_LANDMARKS_LEFT_IRIS, parts.FACE_LANDMARKS_RIGHT_IRIS],
            0.04,
        ),
        "eyebrows": filled([parts.FACE_LANDMARKS_LEFT_EYEBROW, parts.FACE_LANDMARKS_RIGHT_EYEBROW], 0.025),
        "nose": filled([parts.FACE_LANDMARKS_NOSE], 0.02),
        "mouth": filled([parts.FACE_LANDMARKS_LIPS], 0.03),
        "face_edge": grow_softly(face_edge, 0.02 * face_width),
    }
    overlap = np.maximum(sum(features.values()), 1)
    return {name: mask / overlap for name, mask in features.items()}


def point_indices(connections) -> list[int]:
    return sorted({c.start for c in connections} | {c.end for c in connections})


def grow_softly(mask: np.ndarray, distance_px: float) -> np.ndarray:
    if distance_px < 0.5:
        return mask
    blurred = cv2.GaussianBlur(mask, (0, 0), sigmaX=distance_px)
    return np.clip(blurred * 2, 0, 1)
