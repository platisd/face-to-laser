import xml.etree.ElementTree as ElementTree

import ezdxf
import numpy as np
import pytest
from PIL import Image

from face_to_laser.analysis import PhotoAnalysis
from face_to_laser.app import controls_in_use, settings_from_values, values_from_settings
from face_to_laser.export_files import export_laser_files
from face_to_laser.image_steps import to_dots, to_stencil
from face_to_laser.laser_job import EMPTY_BORDER_MM, make_laser_job
from face_to_laser.outlines import grow
from face_to_laser.settings import AREA_NAMES, DITHER_METHODS, Settings, settings_from_json, settings_to_json


def round_face_photo(size: int = 200) -> PhotoAnalysis:
    y, x = np.mgrid[:size, :size]
    distance_from_center = np.hypot(x - size / 2, y - size / 2)
    person = (distance_from_center < size * 0.45).astype(np.float32)
    gray_gradient = (x / size * 255).astype(np.uint8)
    rgb = np.dstack([gray_gradient] * 3)
    return PhotoAnalysis(rgb=rgb, person=person, areas={"skin": person * 0.5}, message="")


def test_settings_survive_save_and_load():
    settings = Settings(width_mm=123, look="stencil")
    settings.areas["eyes"].contrast = 0.9
    assert settings_from_json(settings_to_json(settings)) == settings


def test_loading_old_settings_file_fills_in_missing_values():
    loaded = settings_from_json('{"width_mm": 80, "unknown": 1, "areas": {"hair": {"contrast": 1.0}}}')
    assert loaded.width_mm == 80
    assert loaded.areas["hair"].contrast == 1.0
    assert loaded.areas["eyes"] == Settings().areas["eyes"]


def test_ui_values_match_settings():
    paths = [("width_mm",), ("look",)] + [("areas", name, "brightness") for name in AREA_NAMES]
    settings = Settings(width_mm=77, look="stencil")
    assert values_from_settings(paths, settings_from_values(paths, values_from_settings(paths, settings))) == (
        values_from_settings(paths, settings)
    )


@pytest.mark.parametrize("method", DITHER_METHODS)
def test_dots_keep_the_average_brightness(method):
    gray = np.full((64, 64), 0.3)
    dots = to_dots(gray, method)
    assert set(np.unique(dots)) <= {0, 255}
    allowed_difference = 0.1 if method == "atkinson" else 0.05
    assert abs(dots.mean() / 255 - 0.3) < allowed_difference


def test_stencil_removes_tiny_spots():
    gray = np.ones((50, 50), np.float32)
    gray[25, 25] = 0
    gray[5:20, 5:20] = 0
    stencil = to_stencil(gray, level=0.5, min_spot_px=4)
    assert stencil[25, 25] == 255
    assert stencil[12, 12] == 0


def test_grow_adds_the_right_distance():
    shape = np.zeros((50, 50), np.uint8)
    shape[20:30, 20:30] = 1
    grown = grow(shape, 5)
    assert grown[25, 15] == 1
    assert grown[25, 14] == 0


def test_finished_piece_has_the_chosen_width():
    job = make_laser_job(round_face_photo(), Settings(width_mm=50, dots_per_mm=10))
    assert job.width_mm == pytest.approx(50, abs=0.2)


def test_cut_line_moves_out_with_gap_and_burned_outline():
    settings = Settings(width_mm=50, cut_smoothness_mm=0, cut_gap_mm=2, burned_outline_on=True, burned_outline_mm=3)
    job = make_laser_job(round_face_photo(), settings)
    photo_width_mm = 50 - 2 * (2 + 3 + EMPTY_BORDER_MM)
    face_width_mm = 0.9 * photo_width_mm
    assert np.ptp(job.cut_line_mm[:, 0]) == pytest.approx(face_width_mm + 2 * (2 + 3), abs=0.3)


def test_nothing_is_burned_outside_the_cut_line():
    job = make_laser_job(round_face_photo(), Settings(width_mm=50, brightness=-2))
    assert (job.engrave[0, :] == 255).all()
    assert (job.engrave[job.engrave.shape[0] // 2, 2:-2] == 0).any()


def test_burned_outline_is_black():
    job = make_laser_job(round_face_photo(), Settings(width_mm=50, burned_outline_on=True, burned_outline_mm=3))
    middle_row = job.engrave[job.engrave.shape[0] // 2]
    first_burned = np.argmax(middle_row == 0)
    assert (middle_row[first_burned : first_burned + 25] == 0).all()


def test_export_writes_readable_files(tmp_path):
    job = make_laser_job(round_face_photo(), Settings(width_mm=50))
    files = {path.name: path for path in export_laser_files(job, tmp_path, "face")}
    assert set(files) == {"face_engrave.png", "face_combined.svg", "face_cut.svg", "face_cut.dxf"}

    png = Image.open(files["face_engrave.png"])
    assert png.mode == "1"
    assert png.info["dpi"][0] == pytest.approx(254, abs=0.1)

    svg = ElementTree.parse(files["face_combined.svg"]).getroot()
    assert svg.get("width") == f"{job.width_mm:.3f}mm"

    polylines = list(ezdxf.readfile(files["face_cut.dxf"]).modelspace().query("LWPOLYLINE"))
    assert len(polylines) == 1 and polylines[0].closed


def test_no_cut_files_when_cut_line_is_off(tmp_path):
    job = make_laser_job(round_face_photo(), Settings(width_mm=50, cut_line_on=False))
    names = {path.name for path in export_laser_files(job, tmp_path, "face")}
    assert names == {"face_engrave.png", "face_combined.svg"}


def test_only_settings_for_the_chosen_options_are_in_use():
    paths = [("areas", "eyes", "contrast")]
    in_use = controls_in_use(paths, look="stencil", burned_outline_on=False, cut_line_on=False, use_face_areas=False)
    assert not in_use[("dither_method",)]
    assert in_use[("stencil_level",)]
    assert not in_use[("burned_outline_mm",)]
    assert not in_use[("cut_gap_mm",)]
    assert not in_use[("cut_smoothness_mm",)]
    assert not in_use[("areas", "eyes", "contrast")]
