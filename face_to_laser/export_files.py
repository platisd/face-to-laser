import base64
import io
from pathlib import Path

import ezdxf
import numpy as np
from PIL import Image

from face_to_laser.laser_job import LaserJob

MM_PER_INCH = 25.4
CUT_LINE_COLOR = "#ff0000"
CUT_LINE_WIDTH_MM = 0.1
DXF_RED = 1


def export_laser_files(job: LaserJob, folder: Path, name: str) -> list[Path]:
    folder.mkdir(parents=True, exist_ok=True)
    engrave_png = engrave_png_bytes(job)
    files = {
        folder / f"{name}_engrave.png": engrave_png,
        folder / f"{name}_combined.svg": svg_text(job, engrave_png).encode(),
    }
    if job.cut_line_mm is not None:
        files[folder / f"{name}_cut.svg"] = svg_text(job, None).encode()
        files[folder / f"{name}_cut.dxf"] = dxf_text(job).encode()
    for path, content in files.items():
        path.write_bytes(content)
    return list(files)


def engrave_png_bytes(job: LaserJob) -> bytes:
    dots_per_inch = job.dots_per_mm * MM_PER_INCH
    buffer = io.BytesIO()
    Image.fromarray(job.engrave).convert("1").save(buffer, format="PNG", dpi=(dots_per_inch, dots_per_inch))
    return buffer.getvalue()


def svg_text(job: LaserJob, engrave_png: bytes | None) -> str:
    width, height = f"{job.width_mm:.3f}", f"{job.height_mm:.3f}"
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{width}mm" height="{height}mm" viewBox="0 0 {width} {height}">',
    ]
    if engrave_png is not None:
        data = "data:image/png;base64," + base64.b64encode(engrave_png).decode()
        parts.append(
            f'<image x="0" y="0" width="{width}" height="{height}" preserveAspectRatio="none" '
            f'style="image-rendering:pixelated" href="{data}" xlink:href="{data}"/>'
        )
    if job.cut_line_mm is not None:
        parts.append(
            f'<path d="{svg_path(job.cut_line_mm)}" fill="none" '
            f'stroke="{CUT_LINE_COLOR}" stroke-width="{CUT_LINE_WIDTH_MM}"/>'
        )
    parts.append("</svg>")
    return "\n".join(parts)


def svg_path(points_mm: np.ndarray) -> str:
    first, *rest = (f"{x:.3f} {y:.3f}" for x, y in points_mm)
    return f"M {first} " + " ".join(f"L {point}" for point in rest) + " Z"


def dxf_text(job: LaserJob) -> str:
    drawing = ezdxf.new(units=ezdxf.units.MM)
    flipped_points = [(x, job.height_mm - y) for x, y in job.cut_line_mm]
    drawing.modelspace().add_lwpolyline(flipped_points, close=True, dxfattribs={"color": DXF_RED})
    stream = io.StringIO()
    drawing.write(stream)
    return stream.getvalue()
