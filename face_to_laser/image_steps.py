import cv2
import numba
import numpy as np

SMOOTHING_REACH_MM = 0.4
CONTRAST_REACH_MM = 3.0
EVEN_LIGHTING_TILES = 8

ERROR_SPREADS = {
    "floyd_steinberg": (np.array([[0, 0, 7], [3, 5, 1]]) / 16, 1),
    "jarvis": (np.array([[0, 0, 0, 7, 5], [3, 5, 7, 5, 3], [1, 3, 5, 3, 1]]) / 48, 2),
    "stucki": (np.array([[0, 0, 0, 8, 4], [2, 4, 8, 4, 2], [1, 2, 4, 2, 1]]) / 42, 2),
    "atkinson": (np.array([[0, 0, 1, 1], [1, 1, 1, 0], [0, 1, 0, 0]]) / 8, 1),
}


def even_out_lighting(gray: np.ndarray, strength: float) -> np.ndarray:
    if strength <= 0:
        return gray
    clahe = cv2.createCLAHE(clipLimit=1 + 3 * strength, tileGridSize=(EVEN_LIGHTING_TILES, EVEN_LIGHTING_TILES))
    evened = clahe.apply(to_uint8(gray)).astype(np.float32) / 255
    return gray * (1 - strength) + evened * strength


def apply_tone(
    gray: np.ndarray,
    smoothing: np.ndarray,
    contrast: np.ndarray,
    brightness: np.ndarray,
    dots_per_mm: float,
) -> np.ndarray:
    smooth = gray
    for _ in range(2):
        smooth = cv2.bilateralFilter(smooth, d=-1, sigmaColor=0.1, sigmaSpace=SMOOTHING_REACH_MM * dots_per_mm)
    details = gray - smooth
    gray = smooth + details * (1 - np.clip(smoothing, -1, 1))

    local_average = cv2.GaussianBlur(gray, (0, 0), sigmaX=CONTRAST_REACH_MM * dots_per_mm)
    gray = local_average + (gray - local_average) * (1 + np.clip(contrast, -0.9, 3))

    gamma = 2.0 ** -np.clip(brightness, -2, 2)
    return np.clip(gray, 0, 1) ** gamma


def to_dots(gray: np.ndarray, method: str) -> np.ndarray:
    if method == "ordered":
        return ordered_dots(gray)
    spread, center_column = ERROR_SPREADS[method]
    return spread_errors(gray.astype(np.float64), spread, center_column)


@numba.njit(cache=True)
def spread_errors(gray, spread, center_column):
    height, width = gray.shape
    work = gray.copy()
    result = np.zeros((height, width), np.uint8)
    spread_height, spread_width = spread.shape
    for y in range(height):
        for x in range(width):
            new_value = 1.0 if work[y, x] >= 0.5 else 0.0
            result[y, x] = 255 if new_value == 1.0 else 0
            error = work[y, x] - new_value
            for dy in range(spread_height):
                if y + dy >= height:
                    break
                for dx in range(spread_width):
                    weight = spread[dy, dx]
                    target_x = x + dx - center_column
                    if weight != 0 and 0 <= target_x < width:
                        work[y + dy, target_x] += error * weight
    return result


def ordered_dots(gray: np.ndarray) -> np.ndarray:
    pattern = np.array([[0]])
    for _ in range(3):
        pattern = np.block([[4 * pattern, 4 * pattern + 2], [4 * pattern + 3, 4 * pattern + 1]])
    thresholds = (pattern + 0.5) / pattern.size
    height, width = gray.shape
    tiled = np.tile(thresholds, (height // 8 + 1, width // 8 + 1))[:height, :width]
    return np.where(gray >= tiled, 255, 0).astype(np.uint8)


def to_stencil(gray: np.ndarray, level: float, min_spot_px: float) -> np.ndarray:
    if min_spot_px >= 1:
        gray = cv2.GaussianBlur(gray, (0, 0), sigmaX=min_spot_px / 3)
    black = (gray < level).astype(np.uint8)
    if min_spot_px >= 2:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (round(min_spot_px),) * 2)
        black = cv2.morphologyEx(black, cv2.MORPH_OPEN, kernel)
        black = cv2.morphologyEx(black, cv2.MORPH_CLOSE, kernel)
    return np.where(black == 1, 0, 255).astype(np.uint8)


def to_uint8(gray: np.ndarray) -> np.ndarray:
    return np.clip(gray * 255 + 0.5, 0, 255).astype(np.uint8)
