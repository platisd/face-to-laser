import cv2
import numpy as np


def solid_shape(person: np.ndarray, smoothness_px: float) -> np.ndarray:
    if smoothness_px >= 0.5:
        person = cv2.GaussianBlur(person, (0, 0), sigmaX=smoothness_px)
    shape = (person > 0.5).astype(np.uint8)
    return fill_holes(shape)


def fill_holes(shape: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(shape, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(shape)
    cv2.drawContours(filled, contours, -1, 1, thickness=cv2.FILLED)
    return filled


def grow(shape: np.ndarray, distance_px: float) -> np.ndarray:
    if distance_px <= 0:
        return shape
    distance_to_shape = cv2.distanceTransform(1 - shape, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    return (distance_to_shape <= distance_px).astype(np.uint8)


def smooth_shape(shape: np.ndarray, smoothness_px: float) -> np.ndarray:
    if smoothness_px < 0.5:
        return shape
    blurred = cv2.GaussianBlur(shape.astype(np.float32), (0, 0), sigmaX=smoothness_px)
    return fill_holes((blurred > 0.5).astype(np.uint8))


def keep_biggest_piece(shape: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
    contours, _ = cv2.findContours(shape, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return np.zeros_like(shape), None
    biggest = max(contours, key=cv2.contourArea)
    only_biggest = np.zeros_like(shape)
    cv2.drawContours(only_biggest, [biggest], -1, 1, thickness=cv2.FILLED)
    return only_biggest, biggest


def contour_to_mm(contour: np.ndarray, dots_per_mm: float, max_error_mm: float = 0.05) -> np.ndarray:
    simpler = cv2.approxPolyDP(contour, epsilon=max_error_mm * dots_per_mm, closed=True)
    return (simpler.reshape(-1, 2).astype(np.float64) + 0.5) / dots_per_mm
