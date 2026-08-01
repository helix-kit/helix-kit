#!/bin/bash
# Push the cross-built binaries and this lab's board-side scripts to the Radxa.
#   ./deploy.sh                       # default board
#   BOARD=radxa@10.0.0.5 ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
BOARD=${BOARD:-radxa@192.168.1.59}
TGZ=${OUT:-/tmp/llama-aarch64.tgz}
SSHOPT="-o BatchMode=yes -o ConnectTimeout=15"
# the board's sshd is old; its post-quantum banner is noise on every invocation
quiet() { grep -viE 'post-quantum|store now|openssh\.com|^\*\*' || true; }

[ -f "$TGZ" ] || { echo "no $TGZ — run ./build-aarch64.sh first" >&2; exit 1; }

echo "==> binaries -> ~/llama-x"
scp -q $SSHOPT "$TGZ" "$BOARD:/tmp/llama-aarch64.tgz" 2>&1 | quiet
ssh $SSHOPT "$BOARD" 'mkdir -p ~/llama-x && tar xzf /tmp/llama-aarch64.tgz -C ~/llama-x' 2>&1 | quiet

echo "==> scripts -> ~"
scp -q $SSHOPT chat.sh bench.sh fetch-models.sh "$BOARD:~/" 2>&1 | quiet
ssh $SSHOPT "$BOARD" 'chmod +x ~/chat.sh ~/bench.sh ~/fetch-models.sh' 2>&1 | quiet

echo "==> smoke test"
ssh $SSHOPT "$BOARD" 'cd ~/llama-x && LD_LIBRARY_PATH=$PWD ./llama-cli --version 2>&1 | head -3' 2>&1 | quiet

echo
echo "on the board:  ./fetch-models.sh  then  ./bench.sh  or  ./chat.sh"
