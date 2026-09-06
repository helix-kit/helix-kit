<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Radxa LLM — running (and teaching) a small model on-device

Exploratory — a practice board, **nothing here is wired into the main Helix build**.

Two tracks, in order:

| | track | state |
| --- | --- | --- |
| **A** | [`runtime/`](runtime/) — get llama.cpp running fast on the board | **done, measured** |
| **B** | tool-calling fine-tune (below) | scaffolded, not started |

## A. Runtime — how fast is the board? (done)

`Qwen2.5-0.5B-Instruct` at **Q4_0, 6 threads, 12k context: 23.8 t/s generation /
148.9 t/s prompt** on the **Radxa Cubie A7Z** (Allwinner A733, 2× A76 + 6× A55, 961 MB
RAM), CPU only. Readable typing speed.

The three findings that got it there: the board cannot build llama.cpp itself (cross-
compile instead), `+dotprod` plus Q4_0 is worth +35% generation and 3.7× prompt because
of ggml's ARM weight repacking, and on a 961 MB machine a contaminated benchmark looks
exactly like a clean one.

→ [`runtime/README.md`](runtime/README.md) to run it,
[`docs/00-llama-cpp-bringup.md`](docs/00-llama-cpp-bringup.md) for the method, numbers
and open threads.

## B. Tool calling — can a 0.5B model drive real tools? (not started)

Fast enough to be an on-device agent — *if* it can reliably pick the right tool, emit
well-formed arguments, and know when **not** to call. This track answers that with
numbers. All training happens on the laptop **GTX 1650** so iteration stays fast; the
tuned model is only *eventually* pushed back to the board (a deferred step, gated on the
results below).

```
[0] setup      uv venv (py3.11) + Unsloth stack + pull Qwen2.5-0.5B-Instruct (HF safetensors)
[1] baseline   eval STOCK 0.5B on a BFCL-lite harness  ── "any good out of the box?"
[2] stage-A    LoRA fine-tune on xLAM-60k (general function calling) ── the primary answer
[3] stage-B    LoRA fine-tune on synthesized HELIX-tool data ── "can it drive OUR tools?"
[4] verdict    baseline vs A vs B table -> gate to a deferred GGUF-export + board deploy
```

We teach the model's **native** tool-call format (Qwen2.5 already ships a Hermes-style
`<tools>…</tools>` / `<tool_call>{"name","arguments"}</tool_call>` template), rendered via
`tokenizer.apply_chat_template(..., tools=...)` — not a bespoke format.

### Hardware constraints (baked into the scripts)

- **GTX 1650, 4 GB VRAM, Turing (sm_75)** → **fp16** (no bf16), no FlashAttention-2
  (Unsloth's kernels handle it). 0.5B in 16-bit LoRA fits 4 GB with grad checkpointing.
- Base Python is 3.14 (too new for the ML stack) → dedicated **Python 3.11** venv via `uv`.

### Layout (to be written)

```
setup.sh                 # env + deps + model download + smoke test
requirements.txt         # frozen pin mirror (setup.sh is authoritative)
common.py                # shared: contract->tool-schema, tool_call parsing, scoring
prepare_data.py          # xLAM-60k -> native template train jsonl + frozen eval slice
prepare_helix_data.py    # Helix contract JSON -> synthesized tool-call dataset
train.py                 # Unsloth 16-bit LoRA SFT (--stage a|b, --base, --out)
eval.py                  # BFCL-lite harness (transformers+peft; decoupled from Unsloth)
chat.py                  # interactive spot-check
data/  adapters/  results/  models/   # gitignored artifacts
docs/01-tool-calling-spike.md          # lab notes + final verdict table
```

### Run

```sh
cd experimental/radxa-llm
./setup.sh                                    # [0]
source .venv/bin/activate
python prepare_data.py                        # build data/xlam_train.jsonl + data/eval_*.jsonl
python eval.py --base models/Qwen2.5-0.5B-Instruct --stage baseline   # [1]
python train.py --stage a --base models/Qwen2.5-0.5B-Instruct \
    --data data/xlam_train.jsonl --out adapters/stage-a --save-merged  # [2]
python eval.py --base models/Qwen2.5-0.5B-Instruct --adapter adapters/stage-a --stage stage-a
python prepare_helix_data.py                  # build data/helix_train.jsonl + data/eval_helix.jsonl
python train.py --stage b --base adapters/stage-a-merged \
    --data data/helix_train.jsonl --out adapters/stage-b                # [3]
python eval.py --base adapters/stage-a-merged --adapter adapters/stage-b --stage stage-b \
    --sets helix
```

### Status

- [ ] M0 — env + model + smoke generate on the GPU
- [ ] M1 — BFCL-lite harness + stock baseline numbers
- [ ] M2 — stage-A (xLAM) fine-tune + eval lift
- [ ] M3 — stage-B (Helix tools) fine-tune + eval
- [ ] M4 — verdict table + gate decision
- [ ] (deferred) GGUF export + Radxa on-device verify — track A is already the runtime
      for this; export at **Q4_0**, not Q4_K_M, and re-measure quality
