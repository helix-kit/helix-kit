<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# On-device runtime — llama.cpp on the Radxa Cubie A7Z

The measured baseline the fine-tune track aims at: **Qwen2.5-0.5B-Instruct Q4_0 at
23.8 t/s generation / 148.9 t/s prompt** on the board's CPU, 6 threads, 12k context.

Full method and reasoning: [`../docs/00-llama-cpp-bringup.md`](../docs/00-llama-cpp-bringup.md).

## Run it

```sh
./build-aarch64.sh          # laptop: cross-build llama.cpp -> /tmp/llama-aarch64.tgz
./deploy.sh                 # laptop: push binaries + board scripts (BOARD=radxa@…)

ssh radxa@192.168.1.59
./fetch-models.sh           # board: pull the GGUF quants
./bench.sh                  # board: threads + quants + flags sweeps
./chat.sh                   # board: interactive
```

`chat-cuda.sh` runs the same model on the laptop's GTX 1650 for comparison; it needs a
separate CUDA build (the header comments have the cmake line).

## Files

| | |
| --- | --- |
| `Dockerfile`, `toolchain-aarch64.cmake` | debian:bullseye cross image (glibc 2.31 floor) |
| `build-aarch64.sh` | cross-build + glibc check + tarball |
| `deploy.sh` | scp binaries and board scripts, smoke-test |
| `fetch-models.sh` | GGUF quants (board) |
| `bench.sh` | the sweep harness, incl. the quiesce step (board) |
| `chat.sh` / `chat-cuda.sh` | interactive, board / laptop GPU |
| `results/` | raw logs captured 2026-07-20, recovered from the board backup |

## Results (2026-07-20)

`results/` holds the raw `llama-bench` output verbatim. Reading order:

| log | what it shows |
| --- | --- |
| `build-onboard-native-oom.log` | why the board cannot build llama.cpp itself |
| `bench-01-threads2-taskset-a76.log` | first signal — 2 threads pinned to the A76 pair |
| `bench-02-thread-sweep.log` | 1/2/4/6/8 threads |
| `bench-03-thread-sweep-perf-governor.log` | same, `performance` governor |
| `bench-04-quant-sweep-contended.log` | **invalid** — a chat session was still running; kept as the counter-example |
| `bench-05-quant-sweep-clean.log` | the definitive quant + flag sweep |
| `gen-01-q4km-single-turn.log` | a real generation, Q4_K_M |
| `bench-06-cuda-gtx1650.log` | same model on the laptop GPU |
| `bench-07-reproduction-2026-08-01.log` | **the whole lab re-run from scratch**, newer llama.cpp, reimaged board — 23.7 t/s live |

## Not recovered

The `~/llama-x` binaries and the GGUF files live in
`~/helixos-a733/board-home-backup.tar` (`home/radxa/llama-x/`, `home/radxa/models/`) but
are build artifacts and downloads — `build-aarch64.sh` and `fetch-models.sh` regenerate
both, so they are deliberately not committed.
