from __future__ import annotations

import json
import os
import subprocess
import time
from typing import Any

import click

from tooling.common.paths import REPO_ROOT
from tooling.common.process import run

AMI_DIR = REPO_ROOT / "cloud" / "ami"
ARTIFACTS = AMI_DIR / "artifacts"
RAW_IMAGE = ARTIFACTS / "helix-ami.raw"
BUILDER_TAG = "helix/ami-builder:dev"

DEFAULT_PROFILE = "admin"
VMIMPORT_ROLE = "vmimport"


def _aws(
    args: list[str], *, profile: str, capture: bool = False, check: bool = True
) -> subprocess.CompletedProcess[str]:
    return run(
        ["aws", "--profile", profile, *args], cwd=REPO_ROOT, capture_output=capture, check=check
    )


def _aws_json(args: list[str], *, profile: str) -> dict[str, Any]:
    result = _aws([*args, "--output", "json"], profile=profile, capture=True)
    if not result.stdout.strip():
        return {}
    payload = json.loads(result.stdout)
    assert isinstance(payload, dict)
    return payload


@click.group()
def ami() -> None:
    """Build and ship the minimal Helix cloud AMI (systemd-native, no Docker)."""


@ami.command("build")
@click.option(
    "--size", default=None, help="Root partition size in MiB at build time (default 2560)."
)
@click.option(
    "--stages", default=None, help="Space-separated stage subset, e.g. '30-configure 40-disk'."
)
@click.option("--rebuild-builder", is_flag=True, help="Force a rebuild of the builder image.")
@click.option(
    "--arch",
    type=click.Choice(("amd64", "arm64")),
    default="amd64",
    show_default=True,
    help="Target architecture. arm64 => Graviton (t4g), UEFI boot.",
)
def ami_build(size: str | None, stages: str | None, rebuild_builder: bool, arch: str) -> None:
    """Build the bootable raw disk image in a privileged builder container."""
    # Build AS the target arch (binfmt/qemu) so debootstrap/chroot/grub-install run native to the rootfs.
    platform = f"linux/{arch}"
    tag = f"{BUILDER_TAG}-{arch}"

    build_args = ["build", "--platform", platform, "-f", str(AMI_DIR / "Dockerfile.builder")]
    build_args += ["-t", tag]
    if rebuild_builder:
        build_args.append("--no-cache")
    build_args.append(str(AMI_DIR))
    run(["docker", *build_args], cwd=REPO_ROOT)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    env_flags: list[str] = ["-e", f"AMI_ARCH={arch}"]
    if size:
        env_flags += ["-e", f"AMI_IMAGE_SIZE={size}"]
    if stages:
        env_flags += ["-e", f"STAGES={stages}"]
    # TEST ONLY: pass a smoke-test SSH key (QEMU has no IMDS for cloud-init). Unset for shipped builds.
    test_key = os.environ.get("AMI_TEST_SSH_PUBKEY")
    if test_key:
        env_flags += ["-e", f"AMI_TEST_SSH_PUBKEY={test_key}"]

    run(
        [
            "docker",
            "run",
            "--rm",
            "--privileged",
            "--platform",
            platform,
            "-v",
            "/dev:/dev",
            "-v",
            f"{ARTIFACTS}:/out",
            "-v",
            f"{AMI_DIR}:/work",
            # Repo (read-only) so stage 28 installs the appliance stack from cloud/appliance.
            "-v",
            f"{REPO_ROOT}:/repo:ro",
            *env_flags,
            tag,
            "/work/scripts/build.sh",
        ],
        cwd=REPO_ROOT,
    )
    click.echo(f"\nraw image: {RAW_IMAGE}")


@ami.command("qemu")
@click.option(
    "--memory",
    default="1024",
    show_default=True,
    help="Guest RAM (MiB) — mirror the t3.micro / t4g.micro target.",
)
@click.option(
    "--arch",
    type=click.Choice(("amd64", "arm64")),
    default="amd64",
    show_default=True,
    help="Architecture of the built image.",
)
def ami_qemu(memory: str, arch: str) -> None:
    """Boot the built raw image locally in QEMU (serial console)."""
    if not RAW_IMAGE.exists():
        raise click.ClickException(f"{RAW_IMAGE} not found — run `helix ami build` first.")
    if arch == "arm64":
        # aarch64 has no BIOS: boot via UEFI (edk2) like EC2 Graviton does.
        firmware = next(
            (
                p
                for p in (
                    "/usr/share/AAVMF/AAVMF_CODE.fd",
                    "/usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
                    "/usr/share/edk2/aarch64/QEMU_EFI.fd",
                )
                if os.path.exists(p)
            ),
            None,
        )
        if firmware is None:
            raise click.ClickException(
                "aarch64 UEFI firmware not found — install it with:\n"
                "  sudo apt-get install qemu-system-arm qemu-efi-aarch64"
            )
        run(
            [
                "qemu-system-aarch64",
                "-machine",
                "virt",
                "-cpu",
                "cortex-a72",
                "-bios",
                firmware,
                "-m",
                memory,
                "-drive",
                f"file={RAW_IMAGE},format=raw,if=virtio",
                "-netdev",
                "user,id=n0",
                "-device",
                "virtio-net-pci,netdev=n0",
                "-nographic",
                "-serial",
                "mon:stdio",
            ],
            cwd=REPO_ROOT,
        )
        return
    run(
        [
            "qemu-system-x86_64",
            "-m",
            memory,
            "-drive",
            f"file={RAW_IMAGE},format=raw,if=virtio",
            # User-mode NIC so eth0 gets a DHCP lease and network-online is reached promptly.
            "-netdev",
            "user,id=n0",
            "-device",
            "virtio-net-pci,netdev=n0",
            "-nographic",
            "-serial",
            "mon:stdio",
        ],
        cwd=REPO_ROOT,
    )


@ami.command("clean")
def ami_clean() -> None:
    """Remove build artifacts (rootfs + raw image)."""
    run(
        [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{ARTIFACTS}:/out",
            "debian:trixie-slim",
            "rm",
            "-rf",
            "/out/rootfs",
            "/out/mnt",
            "/out/helix-ami.raw",
        ],
        cwd=REPO_ROOT,
    )
    click.echo("cleaned.")


@ami.command("import")
@click.option("--profile", default=DEFAULT_PROFILE, show_default=True)
@click.option(
    "--bucket", default=None, help="S3 bucket for the import (default helix-ami-import-<account>)."
)
@click.option("--name", default="helix-cloud", show_default=True, help="AMI name.")
@click.option(
    "--arch",
    type=click.Choice(("amd64", "arm64")),
    default="amd64",
    show_default=True,
    help="Architecture of the built image. arm64 registers a UEFI/Graviton AMI.",
)
@click.option(
    "--format",
    "disk_format",
    type=click.Choice(["raw", "vmdk"]),
    default="vmdk",
    show_default=True,
    help="Upload format. 'vmdk' converts to a compressed, sparse stream-optimized "
    "VMDK first (the raw image is mostly zeros — this cuts the S3 upload several-fold); "
    "'raw' uploads the raw image verbatim.",
)
def ami_import(profile: str, bucket: str | None, name: str, arch: str, disk_format: str) -> None:
    """Upload the disk image to S3, import it as an EBS snapshot, and register an AMI."""
    if not RAW_IMAGE.exists():
        raise click.ClickException(f"{RAW_IMAGE} not found — run `helix ami build` first.")

    account = _aws_json(["sts", "get-caller-identity"], profile=profile)["Account"]
    region = (
        _aws(["configure", "get", "region"], profile=profile, capture=True).stdout.strip()
        or "ap-south-1"
    )
    bucket = bucket or f"helix-ami-import-{account}"

    if disk_format == "vmdk":
        upload = ARTIFACTS / "helix-ami.vmdk"
        key, container_format = "helix-ami.vmdk", "VMDK"
        click.echo(f"→ converting {RAW_IMAGE.name} → stream-optimized {upload.name}")
        run(
            [
                "qemu-img",
                "convert",
                "-f",
                "raw",
                "-O",
                "vmdk",
                "-o",
                "subformat=streamOptimized",
                str(RAW_IMAGE),
                str(upload),
            ],
            cwd=REPO_ROOT,
        )
    else:
        upload, key, container_format = RAW_IMAGE, "helix-ami.raw", "RAW"

    _ensure_bucket(bucket, region=region, profile=profile)
    _ensure_vmimport_role(bucket, profile=profile)

    click.echo(f"→ uploading {upload} to s3://{bucket}/{key}")
    _aws(["s3", "cp", str(upload), f"s3://{bucket}/{key}"], profile=profile)

    click.echo(f"→ import-snapshot ({container_format} → EBS snapshot)")
    container = {
        "Description": "helix-ami",
        "Format": container_format,
        "UserBucket": {"S3Bucket": bucket, "S3Key": key},
    }
    task = _aws_json(
        [
            "ec2",
            "import-snapshot",
            "--description",
            "helix-ami",
            "--disk-container",
            json.dumps(container),
        ],
        profile=profile,
    )
    task_id = task["ImportTaskId"]
    snapshot_id = _wait_import_snapshot(task_id, profile=profile)
    click.echo(f"   snapshot: {snapshot_id}")

    # Graviton is UEFI-only; x86 keeps the legacy-BIOS image we already ship.
    ec2_arch = "arm64" if arch == "arm64" else "x86_64"
    boot_mode = "uefi" if arch == "arm64" else "legacy-bios"
    click.echo(f"→ register-image (HVM / {ec2_arch} / ENA / {boot_mode})")
    image = _aws_json(
        [
            "ec2",
            "register-image",
            "--name",
            name,
            "--architecture",
            ec2_arch,
            "--virtualization-type",
            "hvm",
            "--ena-support",
            "--boot-mode",
            boot_mode,
            "--root-device-name",
            "/dev/xvda",
            "--block-device-mappings",
            json.dumps(
                [
                    {
                        "DeviceName": "/dev/xvda",
                        "Ebs": {
                            "SnapshotId": snapshot_id,
                            "VolumeType": "gp3",
                            "DeleteOnTermination": True,
                        },
                    }
                ]
            ),
        ],
        profile=profile,
    )
    click.echo(f"\nAMI registered: {image['ImageId']}")


# The relay range is the one people forget: without it allocations succeed but no bytes flow.
TURN_INGRESS: tuple[tuple[str, int, int, str], ...] = (
    ("udp", 3478, 3478, "STUN/TURN"),
    ("tcp", 3478, 3478, "TURN over TCP"),
    ("tcp", 5349, 5349, "TURN over TLS"),
    ("udp", 5349, 5349, "TURN over DTLS"),
    ("udp", 49160, 49259, "TURN relay range (min-port/max-port in turnserver.conf)"),
)


@ami.command("sg-turn")
@click.option("--profile", default=DEFAULT_PROFILE, show_default=True)
@click.option("--sg", "security_group", required=True, help="Security group id to authorize.")
@click.option(
    "--cidr", default="0.0.0.0/0", show_default=True, help="Source CIDR allowed to reach TURN."
)
def ami_sg_turn(profile: str, security_group: str, cidr: str) -> None:
    """Open the TURN ports on a security group (idempotent)."""
    for protocol, from_port, to_port, purpose in TURN_INGRESS:
        result = _aws(
            [
                "ec2",
                "authorize-security-group-ingress",
                "--group-id",
                security_group,
                "--protocol",
                protocol,
                "--port",
                f"{from_port}-{to_port}",
                "--cidr",
                cidr,
            ],
            profile=profile,
            capture=True,
            check=False,
        )
        ports = from_port if from_port == to_port else f"{from_port}-{to_port}"
        if result.returncode == 0:
            click.echo(f"   authorized {protocol}/{ports} — {purpose}")
        elif "InvalidPermission.Duplicate" in (result.stderr or ""):
            click.echo(f"   already open {protocol}/{ports} — {purpose}")
        else:
            raise click.ClickException(
                f"authorize {protocol}/{ports} failed: {(result.stderr or '').strip()}"
            )
    click.echo(f"TURN ingress ready on {security_group} from {cidr}.")


@ami.command("launch")
@click.option("--profile", default=DEFAULT_PROFILE, show_default=True)
@click.option("--ami-id", required=True, help="AMI id from `helix ami import`.")
@click.option("--type", "instance_type", default="t3.micro", show_default=True)
@click.option("--key-name", required=True, help="EC2 key pair name for SSH.")
@click.option("--sg", "security_group", required=True, help="Security group id (must allow SSH).")
@click.option("--name", default="helix-ami-test", show_default=True)
@click.option("--subnet", default=None, help="Subnet id (required for --ipv6-only).")
@click.option(
    "--ipv6-only",
    is_flag=True,
    help="No public IPv4 (drops the hourly public-IPv4 charge). Assigns an IPv6 address and "
    "enables the IPv6 IMDS endpoint — without which cloud-init cannot inject the SSH key.",
)
@click.option(
    "--volume-size", default=8, show_default=True, type=int, help="Root EBS volume size (GiB)."
)
def ami_launch(
    profile: str,
    ami_id: str,
    instance_type: str,
    key_name: str,
    security_group: str,
    name: str,
    subnet: str | None,
    ipv6_only: bool,
    volume_size: int,
) -> None:
    """Launch an instance from the imported AMI."""
    image = _aws_json(["ec2", "describe-images", "--image-ids", ami_id], profile=profile)
    root_device = image["Images"][0]["RootDeviceName"]

    args = [
        "ec2",
        "run-instances",
        "--image-id",
        ami_id,
        "--instance-type",
        instance_type,
        "--key-name",
        key_name,
        "--count",
        "1",
        "--block-device-mappings",
        json.dumps(
            [
                {
                    "DeviceName": root_device,
                    "Ebs": {
                        "VolumeSize": volume_size,
                        "VolumeType": "gp3",
                        "DeleteOnTermination": True,
                    },
                }
            ]
        ),
        "--tag-specifications",
        json.dumps([{"ResourceType": "instance", "Tags": [{"Key": "Name", "Value": name}]}]),
    ]

    if ipv6_only:
        if subnet is None:
            raise click.ClickException("--ipv6-only requires --subnet (one with an IPv6 CIDR).")
        # IPv6-only has no IPv4 IMDS: enable the IPv6 endpoint here (+ cloud-init at fd00:ec2::254)
        # or cloud-init can't read the launch SSH key and nobody can log in.
        args += [
            "--network-interfaces",
            json.dumps(
                [
                    {
                        "DeviceIndex": 0,
                        "SubnetId": subnet,
                        "Groups": [security_group],
                        "AssociatePublicIpAddress": False,
                        "Ipv6AddressCount": 1,
                        "DeleteOnTermination": True,
                    }
                ]
            ),
            "--metadata-options",
            "HttpEndpoint=enabled,HttpProtocolIpv6=enabled,HttpTokens=optional",
        ]
    else:
        args += ["--security-group-ids", security_group]
        if subnet is not None:
            args += ["--subnet-id", subnet]

    result = _aws_json(args, profile=profile)
    instance_id = result["Instances"][0]["InstanceId"]
    click.echo(f"launched {instance_id} — waiting for it to run…")
    _aws(["ec2", "wait", "instance-running", "--instance-ids", instance_id], profile=profile)

    desc = _aws_json(["ec2", "describe-instances", "--instance-ids", instance_id], profile=profile)
    instance = desc["Reservations"][0]["Instances"][0]
    if ipv6_only:
        v6 = instance["NetworkInterfaces"][0]["Ipv6Addresses"][0]["Ipv6Address"]
        click.echo(f"\ninstance {instance_id} @ [{v6}]  (IPv6-only — no public IPv4)")
        click.echo(f"  ssh helix@{v6}")
    else:
        ip = instance.get("PublicIpAddress", "<none>")
        click.echo(f"\ninstance {instance_id} @ {ip}\n  ssh helix@{ip}")


def _ensure_bucket(bucket: str, *, region: str, profile: str) -> None:
    exists = _aws(
        ["s3api", "head-bucket", "--bucket", bucket], profile=profile, capture=True, check=False
    )
    if exists.returncode == 0:
        return
    args = ["s3api", "create-bucket", "--bucket", bucket]
    if region != "us-east-1":
        args += ["--create-bucket-configuration", f"LocationConstraint={region}"]
    _aws(args, profile=profile)


def _ensure_vmimport_role(bucket: str, *, profile: str) -> None:
    check = _aws(
        ["iam", "get-role", "--role-name", VMIMPORT_ROLE],
        profile=profile,
        capture=True,
        check=False,
    )
    if check.returncode == 0:
        return
    click.echo(f"→ creating {VMIMPORT_ROLE} IAM role")
    trust = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": "vmie.amazonaws.com"},
                "Action": "sts:AssumeRole",
                "Condition": {"StringEquals": {"sts:ExternalId": "vmimport"}},
            }
        ],
    }
    _aws(
        [
            "iam",
            "create-role",
            "--role-name",
            VMIMPORT_ROLE,
            "--assume-role-policy-document",
            json.dumps(trust),
        ],
        profile=profile,
    )
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["s3:GetBucketLocation", "s3:GetObject", "s3:ListBucket", "s3:PutObject"],
                "Resource": [f"arn:aws:s3:::{bucket}", f"arn:aws:s3:::{bucket}/*"],
            },
            {
                "Effect": "Allow",
                "Action": [
                    "ec2:ModifySnapshotAttribute",
                    "ec2:CopySnapshot",
                    "ec2:RegisterImage",
                    "ec2:Describe*",
                ],
                "Resource": "*",
            },
        ],
    }
    _aws(
        [
            "iam",
            "put-role-policy",
            "--role-name",
            VMIMPORT_ROLE,
            "--policy-name",
            "vmimport",
            "--policy-document",
            json.dumps(policy),
        ],
        profile=profile,
    )


def _wait_import_snapshot(task_id: str, *, profile: str) -> str:
    while True:
        desc = _aws_json(
            ["ec2", "describe-import-snapshot-tasks", "--import-task-ids", task_id], profile=profile
        )
        detail = desc["ImportSnapshotTasks"][0]["SnapshotTaskDetail"]
        status = detail.get("Status", "")
        progress = detail.get("Progress", "?")
        message = detail.get("StatusMessage", "")
        click.echo(f"   import: {status} {progress}% {message}")
        if status == "completed":
            snapshot_id = detail["SnapshotId"]
            assert isinstance(snapshot_id, str)
            return snapshot_id
        if status in {"deleted", "deleting", "error"}:
            raise click.ClickException(f"import-snapshot failed: {message}")
        time.sleep(15)
