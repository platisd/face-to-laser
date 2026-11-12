import tempfile
from datetime import datetime
from pathlib import Path

import gradio as gr

from face_to_laser.analysis import PhotoAnalysis, analyze_photo
from face_to_laser.export_files import export_laser_files
from face_to_laser.laser_job import make_laser_job
from face_to_laser.preview import PREVIEW_MODES, PREVIEW_RESULT, make_preview
from face_to_laser.settings import (
    AREA_NAMES,
    DITHER_METHODS,
    LOOKS,
    AreaTuning,
    Settings,
    settings_from_json,
    settings_to_json,
)

OUTPUT_FOLDER = Path(__file__).resolve().parent.parent / "output"
SETTINGS_FOLDER = Path(tempfile.mkdtemp(prefix="face_to_laser_settings_"))
AREA_TUNING_NAMES = ("contrast", "brightness", "smoothing")
SWITCH_PATHS = [("look",), ("burned_outline_on",), ("cut_line_on",), ("use_face_areas",)]
PAGE_STYLE = """
.block:has(input:disabled):not(:has(.block)) {
    opacity: 0.4;
}
.gradio-container {
    overflow: clip !important;
}
#preview-side {
    position: sticky;
    top: 12px;
    align-self: flex-start;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
}
"""

SHOW_BUTTON_NAMES_ON_HOVER = """
() => {
    const addHoverText = () => {
        for (const button of document.querySelectorAll("button[aria-label]:not([title])")) {
            button.title = button.getAttribute("aria-label");
        }
    };
    addHoverText();
    new MutationObserver(addHoverText).observe(document.body, { childList: true, subtree: true });
}
"""


def build_controls() -> dict[tuple[str, ...], gr.components.Component]:
    defaults = Settings()
    controls: dict[tuple[str, ...], gr.components.Component] = {}

    def slider(name, label, low, high, step, info=None):
        controls[(name,)] = gr.Slider(low, high, value=getattr(defaults, name), step=step, label=label, info=info)

    with gr.Accordion("Size", open=True):
        slider("width_mm", "Width of finished piece (mm)", 20, 600, 1)
        slider("dots_per_mm", "Dots per mm", 4, 20, 0.5, "10 = 254 DPI. Higher means finer, but slower to burn.")

    with gr.Accordion("Look", open=True):
        controls[("look",)] = gr.Radio(list(LOOKS), value=defaults.look, label="Look")
        controls[("dither_method",)] = gr.Dropdown(
            list(DITHER_METHODS), value=defaults.dither_method, label="Dot pattern (photo look)"
        )
        slider("stencil_level", "Black level (stencil look)", 0.05, 0.95, 0.01, "Higher means more black.")
        slider("stencil_min_spot_mm", "Smallest spot (stencil look, mm)", 0, 3, 0.1)

    with gr.Accordion("Image", open=True):
        slider("even_lighting", "Even out lighting", 0, 1, 0.05)
        slider("contrast", "Contrast", -1, 2, 0.05)
        slider("brightness", "Brightness", -1, 1.5, 0.05, "Wood burns dark, so a bit brighter is usually better.")
        slider("smoothing", "Smoothing", 0, 1, 0.05, "Removes small details like skin texture.")
        controls[("invert",)] = gr.Checkbox(value=defaults.invert, label="Invert (for dark materials)")

    with gr.Accordion("Face areas", open=False):
        controls[("use_face_areas",)] = gr.Checkbox(value=defaults.use_face_areas, label="Use face areas")
        gr.Markdown("Each value is added on top of the Image values. 0 = no change.")
        for area_name in AREA_NAMES:
            tuning = defaults.areas[area_name]
            with gr.Row():
                gr.Markdown(f"**{area_name.replace('_', ' ').capitalize()}**")
                for tuning_name in AREA_TUNING_NAMES:
                    controls[("areas", area_name, tuning_name)] = gr.Slider(
                        -1, 1, value=getattr(tuning, tuning_name), step=0.05, label=tuning_name.capitalize(), min_width=120
                    )

    with gr.Accordion("Outlines", open=True):
        controls[("burned_outline_on",)] = gr.Checkbox(value=defaults.burned_outline_on, label="Burned outline")
        slider("burned_outline_mm", "Burned outline thickness (mm)", 0.5, 20, 0.5)
        controls[("cut_line_on",)] = gr.Checkbox(value=defaults.cut_line_on, label="Cut line")
        slider("cut_gap_mm", "Space between picture and cut line (mm)", 0, 30, 0.5)
        slider("cut_smoothness_mm", "Outline and cut line smoothness (mm)", 0, 5, 0.1)

    return controls


def controls_in_use(
    paths: list[tuple[str, ...]], look: str, burned_outline_on: bool, cut_line_on: bool, use_face_areas: bool
) -> dict[tuple[str, ...], bool]:
    in_use = {
        ("dither_method",): look == "photo",
        ("stencil_level",): look == "stencil",
        ("stencil_min_spot_mm",): look == "stencil",
        ("burned_outline_mm",): burned_outline_on,
        ("cut_gap_mm",): cut_line_on,
        ("cut_smoothness_mm",): burned_outline_on or cut_line_on,
    }
    in_use.update({path: use_face_areas for path in paths if path[0] == "areas"})
    return in_use


def settings_from_values(paths: list[tuple[str, ...]], values: list) -> Settings:
    simple_values = {}
    area_values: dict[str, dict[str, float]] = {name: {} for name in AREA_NAMES}
    for path, value in zip(paths, values):
        if path[0] == "areas":
            area_values[path[1]][path[2]] = value
        else:
            simple_values[path[0]] = value
    return Settings(**simple_values, areas={name: AreaTuning(**tuning) for name, tuning in area_values.items()})


def values_from_settings(paths: list[tuple[str, ...]], settings: Settings) -> list:
    return [
        getattr(settings.areas[path[1]], path[2]) if path[0] == "areas" else getattr(settings, path[0])
        for path in paths
    ]


def build_app() -> gr.Blocks:
    with gr.Blocks(title="Face to laser") as app:
        photo_analysis = gr.State(None)
        with gr.Row():
            with gr.Column(scale=1):
                photo = gr.Image(label="Photo", type="pil", image_mode="RGBA", sources=["upload", "clipboard"])
                with gr.Row():
                    reset_button = gr.Button("Reset to defaults")
                    save_button = gr.DownloadButton("Save settings")
                    load_button = gr.UploadButton("Load settings", file_types=[".json"])
                controls = build_controls()
            with gr.Column(scale=2, elem_id="preview-side"):
                status = gr.Markdown("Upload a photo to start.")
                with gr.Row():
                    preview_mode = gr.Radio(list(PREVIEW_MODES), value=PREVIEW_RESULT, label="Preview")
                    wood_colors = gr.Checkbox(value=True, label="Wood colors")
                preview = gr.Image(label="Preview", type="numpy", format="png", interactive=False, height="60vh")
                with gr.Row():
                    file_name = gr.Textbox(value="portrait", label="File name")
                    export_button = gr.Button("Export laser files", variant="primary")
                exported_files = gr.File(label="Laser files", file_count="multiple")

        paths = list(controls)
        components = list(controls.values())
        switches = [controls[path] for path in SWITCH_PATHS]
        switched_paths = list(controls_in_use(paths, "photo", True, True, True))
        switched_components = [controls[path] for path in switched_paths]

        def analyze(new_photo):
            if new_photo is None:
                return None, "Upload a photo to start."
            analysis = analyze_photo(new_photo)
            return analysis, analysis.message

        def show_preview(analysis: PhotoAnalysis | None, mode, wood, *values):
            settings = settings_from_values(paths, list(values))
            settings_file = SETTINGS_FOLDER / "laser_settings.json"
            settings_file.write_text(settings_to_json(settings))
            if analysis is None:
                return None, gr.update(), settings_file
            job = make_laser_job(analysis, settings)
            size_text = (
                f"{analysis.message}  \n**Size:** {job.width_mm:.1f} × {job.height_mm:.1f} mm "
                f"({job.engrave.shape[1]} × {job.engrave.shape[0]} dots)"
            )
            return make_preview(job, mode, wood), size_text, settings_file

        def export(analysis: PhotoAnalysis | None, name, *values):
            if analysis is None:
                raise gr.Error("Upload a photo first.")
            settings = settings_from_values(paths, list(values))
            safe_name = "".join(c for c in name if c.isalnum() or c in "-_") or "portrait"
            folder = OUTPUT_FOLDER / f"{safe_name}_{datetime.now():%Y%m%d-%H%M%S}"
            files = export_laser_files(make_laser_job(analysis, settings), folder, safe_name)
            settings_file = folder / f"{safe_name}_settings.json"
            settings_file.write_text(settings_to_json(settings))
            return [str(path) for path in [*files, settings_file]]

        def load_settings(uploaded_file):
            try:
                settings = settings_from_json(Path(uploaded_file).read_text())
            except (ValueError, TypeError) as error:
                raise gr.Error(f"Could not read the settings file: {error}")
            return values_from_settings(paths, settings)

        def enable_controls_in_use(*switch_values):
            in_use = controls_in_use(paths, *switch_values)
            return [gr.update(interactive=in_use[path]) for path in switched_paths]

        preview_inputs = [photo_analysis, preview_mode, wood_colors, *components]
        preview_outputs = [preview, status, save_button]

        photo.change(analyze, photo, [photo_analysis, status]).then(show_preview, preview_inputs, preview_outputs)
        gr.on(
            [component.change for component in [preview_mode, wood_colors, *components]],
            show_preview,
            preview_inputs,
            preview_outputs,
            trigger_mode="always_last",
        )
        reset_button.click(lambda: values_from_settings(paths, Settings()), None, components)
        load_button.upload(load_settings, load_button, components)
        export_button.click(export, [photo_analysis, file_name, *components], exported_files)
        gr.on(
            [app.load, *[switch.change for switch in switches]],
            enable_controls_in_use,
            switches,
            switched_components,
        )
        app.load(show_preview, preview_inputs, preview_outputs)
    return app


def main():
    build_app().launch(
        server_name="0.0.0.0",
        server_port=7860,
        allowed_paths=[str(OUTPUT_FOLDER)],
        css=PAGE_STYLE,
        js=SHOW_BUTTON_NAMES_ON_HOVER,
    )


if __name__ == "__main__":
    main()
