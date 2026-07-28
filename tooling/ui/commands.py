"""`helix ui` -- build and run the common device UI (LVGL) on an emulated device."""

from __future__ import annotations

from pathlib import Path

import click

from embedded.esp32.commands.apps import app_features, write_app_selection
from embedded.esp32.commands.build import resolve_feature_fragments
from embedded.esp32.commands.config import (
    esp32_root,
    idf_build,
    in_esp_idf_docker,
    rerun_in_esp_idf_docker,
    resolve_docker_image,
)

from .session import UI_APP, UI_BUILD_DIR, UiSession


@click.group()
def ui() -> None:
    """Helix device UI: LVGL screens shared by embedded and Linux devices."""


@ui.command()
@click.option("--docker-image", default="")
@click.option("-j", "--jobs", type=click.IntRange(min=0), default=0, show_default=True)
def build(docker_image: str, jobs: int) -> None:
    """Build the `ui_demo` firmware for QEMU (LVGL + the streaming display)."""
    if not in_esp_idf_docker():
        forwarded = ["ui", "build"]
        if jobs > 0:
            forwarded.extend(["--jobs", str(jobs)])
        rerun_in_esp_idf_docker(forwarded, resolve_docker_image(docker_image), jobs=jobs)
        return

    write_app_selection([UI_APP])
    features = app_features([UI_APP])
    idf_build(
        esp32_root() / UI_BUILD_DIR,
        [
            esp32_root() / "sdkconfig.defaults",
            esp32_root() / "sdkconfig.defaults.qemu",
            *resolve_feature_fragments(features),
        ],
        ["build"],
        jobs=jobs,
        features=features,
    )


@ui.command()
@click.option("--docker-image", default="")
@click.option("--scale", type=click.IntRange(1, 4), default=2, show_default=True)
def sim(docker_image: str, scale: int) -> None:
    """Boot the UI firmware in QEMU and open its screen in a window."""
    from .viewer import run_window

    with UiSession(image=resolve_docker_image(docker_image)) as session:
        run_window(session, scale=scale)


@ui.command()
@click.option("--docker-image", default="")
@click.option(
    "--out",
    "out_path",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("reports/ui/hello.png"),
    show_default=True,
)
@click.option("--tap", is_flag=True, help="Tap the button once before capturing.")
def shot(docker_image: str, out_path: Path, tap: bool) -> None:
    """Capture the device's screen to a PNG without opening a window."""
    with UiSession(image=resolve_docker_image(docker_image)) as session:
        session.settle()
        if tap:
            assert session.frame is not None
            session.tap(session.frame.width // 2, session.frame.height // 2)
            session.settle()
        path = session.screenshot(out_path)

    assert session.frame is not None
    click.echo(
        f"wrote {path} ({session.frame.width}x{session.frame.height}, "
        f"{session.frame.frames_applied} rectangles, {session.frame.frames_dropped} dropped)"
    )
