from pathlib import Path

import click

from linux.platform_os.lib import (
    analyze_directory_size,
    delete_file,
    delete_folder,
    format_bytes,
    run_script,
)

ROOTFS_PATH = "platform_os/artifacts/rootfs"
IMAGE_PATH = "platform_os/artifacts/rootfs.img"
SCRIPT_ROOT = Path(__file__).resolve().parents[1] / "scripts"
BUILD_STAGES = [
    "00-debootstrap.sh",
    "10-install-packages.sh",
    "20-configure-users.sh",
    "30-configure-network.sh",
    "40-clean.sh",
    "50-build-rootfs-image.sh",
]


def script_env(
    *,
    arch: str = "amd64",
    suite: str = "resolute",
    target: str = ROOTFS_PATH,
    mirror: str = "http://archive.ubuntu.com/ubuntu",
    image: str = IMAGE_PATH,
    image_size: str = "4G",
    hostname: str = "helix",
    username: str = "helix",
    memory: str = "2048",
) -> dict[str, str]:
    return {
        "ROOTFS_ARCH": arch,
        "ROOTFS_SUITE": suite,
        "ROOTFS_TARGET": target,
        "ROOTFS_MIRROR": mirror,
        "ROOTFS_IMAGE": image,
        "ROOTFS_IMAGE_SIZE": image_size,
        "ROOTFS_HOSTNAME": hostname,
        "ROOTFS_USERNAME": username,
        "QEMU_MEMORY": memory,
    }


@click.group()
def rootfs() -> None:
    """Commands for working with the rootfs."""


@rootfs.command()
@click.option("--arch", default="amd64", show_default=True)
@click.option("--suite", default="resolute", show_default=True)
@click.option("--target", default=ROOTFS_PATH, show_default=True)
@click.option("--mirror", default="http://archive.ubuntu.com/ubuntu", show_default=True)
@click.option("--image", default=IMAGE_PATH, show_default=True)
@click.option("--image-size", default="4G", show_default=True)
@click.option("--hostname", default="helix", show_default=True)
@click.option("--username", default="helix", show_default=True)
def build(
    arch: str,
    suite: str,
    target: str,
    mirror: str,
    image: str,
    image_size: str,
    hostname: str,
    username: str,
) -> None:
    """Build the rootfs image by running numbered scripts."""
    env = script_env(
        arch=arch,
        suite=suite,
        target=target,
        mirror=mirror,
        image=image,
        image_size=image_size,
        hostname=hostname,
        username=username,
    )

    for stage in BUILD_STAGES:
        run_script(SCRIPT_ROOT / stage, env)


@rootfs.command()
@click.option("--target", default=ROOTFS_PATH, show_default=True)
def clean(target: str) -> None:
    """Delete the rootfs directory."""
    delete_folder(Path(target))
    delete_file(Path(IMAGE_PATH))


@rootfs.command()
@click.option("--target", default=ROOTFS_PATH, show_default=True)
@click.option("--depth", default=2, show_default=True, type=click.IntRange(min=0))
@click.option("--limit", default=20, show_default=True, type=click.IntRange(min=1))
def size(target: str, depth: int, limit: int) -> None:
    """Analyze rootfs disk usage."""
    analysis = analyze_directory_size(Path(target), depth=depth, limit=limit)

    click.echo(f"Target: {analysis.target}")
    click.echo(f"Total:  {format_bytes(analysis.total_bytes)} ({analysis.total_bytes} bytes)")
    click.echo("")
    click.echo(f"{'Size':>12}  Path")
    click.echo(f"{'-' * 12}  {'-' * 60}")

    for entry in analysis.entries:
        click.echo(f"{format_bytes(entry.bytes):>12}  {entry.path}")


@rootfs.command()
@click.option("--target", default=ROOTFS_PATH, show_default=True)
@click.option("--image", default=IMAGE_PATH, show_default=True)
@click.option("--memory", default="2048", show_default=True)
def qemu(target: str, image: str, memory: str) -> None:
    """Boot rootfs image directly with QEMU."""
    run_script(
        SCRIPT_ROOT / "90-run-qemu.sh", script_env(target=target, image=image, memory=memory)
    )
