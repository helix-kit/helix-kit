# @helix/ai-kit

Contracts for composing AI assistants out of the pieces they work with.

Calls no model and depends on no AI SDK. It defines what a package says about
itself so a host can assemble several packages into one assistant.

```ts
const assistant = composeAssistant(
  [codeExecutorAuthoring({ inputSchema, outputSchema }), pdfLayoutAuthoring({ catalog })],
  { intro: 'You author PDF report templates.' },
);
// { system, sections, tools, artifacts }
```

## Why a capability, not a prompt

The same piece plays a different role depending on who is using it. Code
execution is an **authoring target** in the report editor (the model writes the
code step), a **runtime tool** in the site assistant (the model calls it), and a
**node config target** in a workflow editor. A package that exported one fixed
prompt string could serve exactly one of those.

So a package exports an `AiCapability` — usually from a factory taking its
environment — carrying three things:

| Field       | What it is                                                     |
| ----------- | -------------------------------------------------------------- |
| `sections`  | named prompt fragments, so a host can override or add just one  |
| `tools`     | provider-neutral descriptors the model can call to check itself |
| `artifacts` | typed outputs, each with a destination and an application mode  |

Keeping all three next to the subject is the point: a prompt that lives in the
consumer drifts from the code it describes, and nobody notices until a model
starts producing something the runtime no longer accepts.

## Sections are named, not concatenated

`extendCapability` and the `sections` option both merge **by id**, and an
override keeps the position the id first appeared at. That is what lets the site
assistant add "here is how to call host functions from inside sandboxed code" to
the code-executor capability while the report editor uses the same capability
without it — neither host has to restate what the other says.

Position is held deliberately. If an override moved its section to the end, the
prompt would quietly reorder itself as capabilities were added, and order is what
establishes context before the parts that depend on it.

## Tools stay provider-neutral

A descriptor is `{ name, description, parameters, execute }` — the host adapts it
to whichever SDK it runs. Model invocation, auth and metering belong to the
application, not to the package describing what can be done. This is the same
shape `@helix/backend/agent` already uses for tRPC procedures.

Duplicate tool names and duplicate artifact kinds are errors, naming both
culprits. Both are addressed by name and a model has no way to tell two apart, so
last-one-wins would be a coin toss resolved at runtime.

## Artifacts route themselves

`createArtifactCollector` turns a stream of artifact events into whole values and
whole patch lines, so each output reaches its destination while the turn is still
running rather than being picked out of prose afterwards.

The buffering matters: deltas break wherever the transport splits them, which
lands mid-line often enough that a consumer parsing each chunk alone would
corrupt roughly every long artifact. Partial trailing lines are held until the
rest arrives, and each kind buffers independently.

Events naming a kind outside the artifact table, or using the wrong mode for
their kind, are reported rather than applied — a model inventing a destination
should not silently write somewhere.

## Turns can be recorded and replayed

`@helix/ai-kit/fixtures` records a real turn to a file and replays it in place of
the provider, so work on the UI a turn drives costs nothing and takes seconds
rather than a minute.

```sh
HELIX_AI_RECORD=pie-chart pnpm dev   # one real turn, written to a fixture
HELIX_AI_REPLAY=pie-chart pnpm dev   # that turn again, for free
```

Both sides are the AI SDK's own seams: recording is a `wrapLanguageModel`
middleware that tees `wrapStream`, and replay is a `MockLanguageModelV4` serving
the recorded parts through `simulateReadableStream`.

The provider's stream parts are kept verbatim rather than summarised, because
what a summary drops — the deltas and their boundaries — is exactly what the UI
has to cope with. An agent loop is many calls, so a fixture holds all of them in
order, and a run that outlasts its recording fails rather than stopping silently.

Tools still execute for real on replay. That is the point: the sandbox, the
checks and the render are local and free, so artifacts stream into the panes
exactly as in a real run while nothing is spent. A replayed turn is not metered,
since billing tokens nobody spent would make the ledger useless.

It refuses to arm outside development rather than trusting the variable to be
absent: a replay reaching production would serve one user's recorded turn to
another.
