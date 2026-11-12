from dataclasses import dataclass

import cv2
import numpy as np

from face_to_laser.analysis import PhotoAnalysis
from face_to_laser.image_steps import apply_tone, even_out_lighting, to_dots, to_stencil
from face_to_laser.outlines import contour_to_mm, grow, keep_biggest_piece, smooth_shape, solid_shape
from face_to_laser.settings import AREA_NAMES, Settings

EMPTY_BORDER_MM = 2.0
SMALLEST_PHOTO_WIDTH_MM = 10.0
NO_BURN = 255
BURN = 0


@dataclass
class LaserJob:
    engrave: np.ndarray
    cut_line_mm: np.ndarray | None
    cut_line_px: np.ndarray | None
    tone: np.ndarray
    areas: dict[str, np.ndarray]
    dots_per_mm: float

    @property
    def width_mm(self) -> float:
        return self.engrave.shape[1] / self.dots_per_mm

    @property
    def height_mm(self) -> float:
        return self.engrave.shape[0] / self.dots_per_mm


def make_laser_job(photo: PhotoAnalysis, settings: Settings) -> LaserJob:
    dots_per_mm = settings.dots_per_mm
    burned_outline_mm = settings.burned_outline_mm if settings.burned_outline_on else 0.0
    cut_gap_mm = settings.cut_gap_mm if settings.cut_line_on else 0.0
    space_around_photo_mm = burned_outline_mm + cut_gap_mm + EMPTY_BORDER_MM
    photo_width_mm = max(SMALLEST_PHOTO_WIDTH_MM, settings.width_mm - 2 * space_around_photo_mm)

    scale = photo_width_mm * dots_per_mm / photo.rgb.shape[1]
    photo_size = (round(photo.rgb.shape[1] * scale), round(photo.rgb.shape[0] * scale))
    border_px = round(space_around_photo_mm * dots_per_mm)

    def fit_to_canvas(image: np.ndarray, border_value: float) -> np.ndarray:
        resized = cv2.resize(image, photo_size, interpolation=cv2.INTER_AREA)
        return cv2.copyMakeBorder(resized, *[border_px] * 4, cv2.BORDER_CONSTANT, value=border_value)

    gray = fit_to_canvas(cv2.cvtColor(photo.rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255, 1.0)
    person = fit_to_canvas(photo.person, 0.0)
    areas = {name: fit_to_canvas(mask, 0.0) for name, mask in photo.areas.items()}

    gray = even_out_lighting(gray, settings.even_lighting)
    tone = apply_tone(gray, **tone_maps(settings, areas, gray.shape), dots_per_mm=dots_per_mm)
    if settings.invert:
        tone = 1 - tone
    tone = tone * person + (1 - person)

    if settings.look == "stencil":
        engrave = to_stencil(tone, settings.stencil_level, settings.stencil_min_spot_mm * dots_per_mm)
    else:
        engrave = to_dots(tone, settings.dither_method)

    smoothness_px = settings.cut_smoothness_mm * dots_per_mm
    shape = solid_shape(person, smoothness_px)
    burned_outline_px = burned_outline_mm * dots_per_mm
    with_outline = grow(shape, burned_outline_px)
    burned_outline = (with_outline == 1) & (shape == 0)
    engrave[burned_outline] = BURN
    tone[burned_outline] = 0

    cut_line_px = cut_line_mm = None
    if settings.cut_line_on:
        cut_shape = smooth_shape(grow(with_outline, cut_gap_mm * dots_per_mm), smoothness_px)
        inside_cut, cut_line_px = keep_biggest_piece(cut_shape)
        engrave[inside_cut == 0] = NO_BURN
        tone[inside_cut == 0] = 1
        if cut_line_px is not None:
            cut_line_mm = contour_to_mm(cut_line_px, dots_per_mm)

    return LaserJob(
        engrave=engrave,
        cut_line_mm=cut_line_mm,
        cut_line_px=cut_line_px,
        tone=tone,
        areas=areas,
        dots_per_mm=dots_per_mm,
    )


def tone_maps(settings: Settings, areas: dict[str, np.ndarray], shape: tuple[int, int]) -> dict[str, np.ndarray]:
    maps = {
        "smoothing": np.full(shape, settings.smoothing, np.float32),
        "contrast": np.full(shape, settings.contrast, np.float32),
        "brightness": np.full(shape, settings.brightness, np.float32),
    }
    if settings.use_face_areas:
        for name in AREA_NAMES:
            if name in areas:
                tuning = settings.areas[name]
                maps["smoothing"] += areas[name] * tuning.smoothing
                maps["contrast"] += areas[name] * tuning.contrast
                maps["brightness"] += areas[name] * tuning.brightness
    return maps
