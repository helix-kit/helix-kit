# Shared helpers for the AMI build stages. Sourced by each stage script.

log()  { printf '\033[1;36m[ami]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[ami] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Bind the host pseudo-filesystems into the rootfs so chroot'd apt/dpkg work,
# and register a cleanup trap that unmounts them in reverse order on exit.
_BOUND=()
bind_pseudo() {
  local root="$1" name mp
  for name in dev dev/pts proc sys run; do
    mp="$root/$name"
    mkdir -p "$mp"
    mountpoint -q "$mp" && continue
    mount --bind "/$name" "$mp"
    _BOUND+=("$mp")
  done
}
unbind_pseudo() {
  local i
  for ((i=${#_BOUND[@]}-1; i>=0; i--)); do
    mountpoint -q "${_BOUND[$i]}" && umount -l "${_BOUND[$i]}"
  done
  _BOUND=()
}

# Run a command inside the rootfs.
in_chroot() { chroot "$ROOTFS" "$@"; }
