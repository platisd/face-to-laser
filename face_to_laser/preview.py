import cv2
import numpy as np

from face_to_laser.image_steps import to_uint8
from face_to_laser.laser_job import LaserJob

WOOD_COLOR = np.array([228, 196, 150], np.float32)
BURNED_WOOD_COLOR = np.array([72, 46, 28], np.float32)
CUT_LINE_COLOR = (255, 0, 0)
CUT_LINE_WIDTH_MM = 0.4

AREA_COLORS = {
    "eyes": (0, 120, 255),
    "eyebrows": (140, 0, 255),
    "nose": (255, 140, 0),
    "mouth": (255, 0, 90),
    "face_edge": (255, 230, 0),
    "skin": (255, 190, 170),
    "hair": (0, 190, 90),
    "clothes": (0, 200, 220),
}

PREVIEW_RESULT = "Result"
PREVIEW_GRAY = "Gray tones (before dots)"
PREVIEW_AREAS = "Face areas"
PREVIEW_MODES = (PREVIEW_RESULT, PREVIEW_GRAY, PREVIEW_AREAS)


def make_preview(job: LaserJob, mode: str, wood_colors: bool) -> np.ndarray:
    if mode == PREVIEW_AREAS:
        picture = colored_areas(job)
    else:
        brightness = job.tone if mode == PREVIEW_GRAY else job.engrave.astype(np.float32) / 255
        picture = paint(brightness, wood_colors)
    if job.cut_line_px is not None:
        thickness = max(1, round(CUT_LINE_WIDTH_MM * job.dots_per_mm))
        cv2.drawContours(picture, [job.cut_line_px], -1, CUT_LINE_COLOR, thickness)
    return picture


def paint(brightness: np.ndarray, wood_colors: bool) -> np.ndarray:
    if not wood_colors:
        return cv2.cvtColor(to_uint8(brightness), cv2.COLOR_GRAY2RGB)
    amount = brightness[:, :, None]
    return (BURNED_WOOD_COLOR * (1 - amount) + WOOD_COLOR * amount).astype(np.uint8)


def colored_areas(job: LaserJob) -> np.ndarray:
    gray = cv2.cvtColor(to_uint8(job.tone), cv2.COLOR_GRAY2RGB).astype(np.float32)
    color = np.zeros_like(gray)
    coverage = np.zeros(gray.shape[:2], np.float32)
    for name, weight in job.areas.items():
        color += weight[:, :, None] * np.array(AREA_COLORS[name], np.float32)
        coverage += weight
    coverage = np.clip(coverage, 0, 1)[:, :, None] * 0.6
    return (gray * (1 - coverage) + color * 0.6).clip(0, 255).astype(np.uint8)
