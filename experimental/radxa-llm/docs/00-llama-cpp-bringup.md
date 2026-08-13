<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# llama.cpp bring-up on the Radxa Cubie A7Z

Date: 2026-07-20 (recovered and written up 2026-08-01)

How fast can a Helix-class Linux edge board actually run a small language model, and what
does it cost to get there? This is the measurement that makes the fine-tune track
([`01-tool-calling-spike.md`](01-tool-calling-spike.md)) worth doing: if the board could
only manage 3 t/s, an on-device agent would be a non-starter regardless of how well the
model called tools.

**Answer: 23.8 t/s generation, 148.9 t/s prompt processing** — Qwen2.5-0.5B-Instruct at
Q4_0, 6 threads, on CPU alone. Readable typing speed. Good enough to build on.

## The board

Radxa Cubie A7Z, Allwinner **A733**: 2× Cortex-A76 (`cpu6-7`) + 6× Cortex-A55
(`cpu0-5`), **961 MB** RAM total with ~750 MB actually available, Debian bullseye
(glibc 2.31), kernel 5.15.147-7-a733. No usable inference accelerator for this workload —
the Vivante VIP9000 NPU runs fixed-function quantised CNNs (see the `radxa-edge-video`
lab), not transformer decode, and the PowerVR GPU has no llama.cpp backend.

That 961 MB is the constraint everything else follows from.

## Building: cross-compile, because the board can't

The obvious first move — clone llama.cpp on the board and build it — does not work.

- `-j2` runs the machine out of memory partway through ggml.
- `-j1` survives but takes over 25 minutes, and the sustained load browns out the board:
  its USB-C sink negotiates only 500 mA, so a long all-core compile trips a reset. The
  build was killed twice by reboots before being abandoned
  (`runtime/results/build-onboard-native-oom.log`).

Cross-compiling in a `debian:bullseye` container takes **~3 minutes**. Bullseye, not
something newer, because the binaries must not reference a glibc symbol version above the
board's 2.31 — `build-aarch64.sh` asserts this with `objdump -T` after linking.

The flag that matters:

```
-DGGML_CPU_ARM_ARCH="armv8.2-a+dotprod+crypto"
```

`+dotprod` is not a micro-optimisation here. It is the precondition for the single
largest win in this whole exercise (below). The container also needs a **native**
`build-essential` alongside the cross toolchain, because ggml builds host-side code
generators as part of its build.

## Threads: 6

Sweeping 1/2/4/6/8 threads on Q4_K_M (`bench-02`, `bench-03`):

| threads | pp64 (t/s) | tg64 (t/s) |
| ---: | ---: | ---: |
| 1 | 15.84 | 11.21 |
| 2 | 30.61 | 16.92 |
| 4 | 33.58 | 15.76 |
| **6** | **37.70** | **17.21** |
| 8 | 40.50 | 17.11 |

Generation is flat from 2 threads on and prompt processing keeps climbing — exactly the
signature of a memory-bandwidth-bound decode with a compute-bound prefill. 8 threads buys
7% more prompt throughput and nothing on generation, at the cost of leaving the machine
with no spare core. **6** is the operating point; `chat.sh` and `bench.sh` both use it.

Pinning to the two A76 cores (`taskset -c 6,7`, `bench-01`) is *not* better than letting
the scheduler use all eight — 17.22 t/s, indistinguishable from 6 unpinned threads.

## Context: 12288

The KV cache competes with the model for the same ~750 MB. 16384 tokens of context loads
and then dies on the way through generation; 8192 and 12288 both hold. **12288** is the
largest that fits with headroom, and it is what `chat.sh` ships.

## Quantisation: Q4_0, and not for the reason you'd guess

The clean sweep (`bench-05`), one model at a time with the page cache dropped between
runs:

| config | pp64 (t/s) | tg64 (t/s) |
| --- | ---: | ---: |
| Q4_K_M (baseline) | 40.75 | 17.66 |
| **Q4_0** | **148.94** | **23.77** |
| Q4_0 + flash-attn | 147.06 | 23.88 |
| Q4_0 + flash-attn + KV q8_0 | 152.23 | 23.53 |

**Q4_0 alone is +35% generation and 3.7× prompt processing.** Flash-attention and KV
quantisation move nothing — at this model size neither the attention kernel nor the KV
cache is the bottleneck.

The win is not about file size. llama.cpp repacks Q4_0 weights into ARM-specific block
layouts (`Q4_0_4_4` / `Q4_0_8_8`) that feed the `dotprod` instruction compiled in above.
K-quants have no equivalent ARM path and fall back to generic code.

The decisive evidence is Q3_K_S from the earlier run: **317 MiB, smaller than Q4_0's
331 MiB, and slower.** If fewer bytes per token were the mechanism, the smaller file
would win. It doesn't — so the gain is instruction selection, and it exists only because
of `+dotprod`.

Q4_0 is a cruder quantisation than Q4_K_M at comparable size, so some quality is being
traded. At 0.5B the model confabulates heavily either way (asked what makes ARM CPUs
efficient, it answered that ARM CPUs are "also known as MIPS"), so the trade is easy
here — but it is a real trade, and it should be re-checked against the tool-calling eval
rather than assumed.

## A contaminated measurement, kept on purpose

`bench-04-quant-sweep-contended.log` reports Q4_K_M at **7.62 ± 0.52** t/s — less than
half the 17.21 measured minutes earlier, with error bars an order of magnitude wider. The
cause was an interactive `chat.sh` session still running in another terminal at 541% CPU,
plus three ~330 MB models mmap'd back-to-back into a 961 MB machine.

It is in `results/` deliberately. On a board this small the difference between a real
number and a garbage one is entirely whether the machine was quiet, and the number that
comes back looks perfectly plausible either way. `bench.sh` therefore refuses to run if
`llama-cli` is alive, stops the desktop stack, pins the governor to `performance`, and
drops the page cache between runs.

## Reference point: the same model on a discrete GPU

Identical model, identical llama.cpp commit, laptop GTX 1650 (`bench-06`):

| | Radxa A7Z (CPU) | GTX 1650 (CUDA) | ratio |
| --- | ---: | ---: | ---: |
| generation (tg64) | 17.2 | 236.2 | 13.7× |
| prompt processing (pp64) | 40.5 | 991.3 | 24.5× |

*(both at Q4_K_M, the only quant built on both sides — the board's Q4_0 result of 23.8 is
not in this comparison.)*

The gap is much wider on prompt processing than on generation, and that asymmetry is the
useful part: generation streams the whole weight set per token and is bandwidth-bound, so
the GPU's lead is capped by memory rather than arithmetic. Prompt processing is batched
matmul, where the GPU's parallelism runs away. Anything that shifts work from decode to
prefill — longer prompts, more few-shot examples — hurts the board far less than it looks
like it should.

llama.cpp also warns that the 1650 is the one Turing part without tensor cores and
suggests rebuilding with Pascal MMQ kernels; that was never tried, so the GPU column is a
floor, not a ceiling.

## Reproduced 2026-08-01

The board was reimaged after the original work, so this lab was rebuilt from nothing and
re-measured — new llama.cpp (`a7a6d0d`, ~6 weeks newer than the original `91d2fc3`), new
cross-build, re-fetched models (`bench-07`):

| | 2026-07-20 (quiesced) | 2026-08-01 (desktop left up) |
| --- | ---: | ---: |
| Q4_K_M pp64 / tg64 | 40.75 / 17.66 | 41.89 / 18.02 |
| Q4_0 pp64 / tg64 | 148.94 / 23.77 | 128.95 / 22.75 |
| live single-turn (Q4_0) | 21.8 t/s | **23.7 t/s** |

Q4_K_M lands within 3%. Q4_0 prompt processing is 13% low, which is the price of leaving
the desktop running — and a second, cheaper demonstration of the quiescing point above.
The conclusions are unchanged.

## Status and what's open

Working and measured: cross-build, deploy, thread/context/quant tuning, interactive chat
on the board at ~24 t/s.

Open:

- **Llama-3.2-1B-Instruct Q4_0 (737 MB) was downloaded to the board but never
  benchmarked.** It is the only larger model that fits, and only with the desktop
  stopped. Expect roughly half the token rate for a substantially more capable model —
  which, given how weakly 0.5B follows instructions, may be the better trade for an agent.
  `WITH_1B=1 ./fetch-models.sh` pulls it.
- **Quality was never measured, only speed.** The Q4_0-vs-Q4_K_M quality delta should be
  quantified against the tool-calling eval, not assumed negligible.
- **`llama-server`** (the tarball already ships `libllama-server-impl.so`) is untried; an
  HTTP endpoint on the board is the natural way to wire this to `helixd`.
- The `bench.sh` **quiesce path is unexercised** — the reproduction run deliberately left
  the board's desktop up rather than stopping it. The service-stopping branch is written
  but never run.
