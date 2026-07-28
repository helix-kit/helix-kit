import click

from .rootfs import rootfs


@click.group()
def platform_os() -> None:
    """Platform OS image tooling."""


platform_os.add_command(rootfs)


def main() -> None:
    platform_os()
