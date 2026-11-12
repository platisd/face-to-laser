import json
from dataclasses import asdict, dataclass, field, fields, replace

AREA_NAMES = ("eyes", "eyebrows", "nose", "mouth", "face_edge", "skin", "hair", "clothes")
DITHER_METHODS = ("jarvis", "stucki", "floyd_steinberg", "atkinson", "ordered")
LOOKS = ("photo", "stencil")


@dataclass
class AreaTuning:
    contrast: float = 0.0
    brightness: float = 0.0
    smoothing: float = 0.0


def default_area_tunings() -> dict[str, AreaTuning]:
    return {
        "eyes": AreaTuning(contrast=0.6, brightness=0.0, smoothing=-0.4),
        "eyebrows": AreaTuning(contrast=0.4, brightness=0.0, smoothing=-0.2),
        "nose": AreaTuning(contrast=0.2, brightness=0.0, smoothing=0.0),
        "mouth": AreaTuning(contrast=0.3, brightness=0.0, smoothing=-0.2),
        "face_edge": AreaTuning(contrast=0.4, brightness=0.0, smoothing=0.0),
        "skin": AreaTuning(contrast=-0.2, brightness=0.2, smoothing=0.4),
        "hair": AreaTuning(contrast=0.6, brightness=0.0, smoothing=-0.2),
        "clothes": AreaTuning(contrast=-0.3, brightness=0.3, smoothing=0.5),
    }


@dataclass
class Settings:
    width_mm: float = 100.0
    dots_per_mm: float = 10.0

    look: str = "photo"
    dither_method: str = "jarvis"
    stencil_level: float = 0.5
    stencil_min_spot_mm: float = 0.4

    even_lighting: float = 0.3
    contrast: float = 0.3
    brightness: float = 0.3
    smoothing: float = 0.2
    invert: bool = False

    use_face_areas: bool = True
    areas: dict[str, AreaTuning] = field(default_factory=default_area_tunings)

    burned_outline_on: bool = False
    burned_outline_mm: float = 3.0

    cut_line_on: bool = True
    cut_gap_mm: float = 0.0
    cut_smoothness_mm: float = 1.0


def settings_to_json(settings: Settings) -> str:
    return json.dumps(asdict(settings), indent=2)


def settings_from_json(text: str) -> Settings:
    loaded = json.loads(text)
    defaults = Settings()
    simple_field_names = {f.name for f in fields(Settings)} - {"areas"}
    known_values = {name: loaded[name] for name in simple_field_names if name in loaded}
    areas = default_area_tunings()
    for area_name, tuning in loaded.get("areas", {}).items():
        if area_name in areas:
            areas[area_name] = replace(areas[area_name], **{k: v for k, v in tuning.items() if k in asdict(AreaTuning())})
    return replace(defaults, **known_values, areas=areas)
