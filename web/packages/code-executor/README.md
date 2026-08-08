# @helix/code-executor

Runs untrusted TypeScript in a QuickJS WASM sandbox.

Deliberately generic. It knows nothing about PDF reports, workflows, tRPC or AI
assistants — a caller supplies what the guest can reach, and that set _is_ the
authority the code receives.

```ts
const result = await executeCode('return input.devices.filter((d) => d.faults > 0).length;', {
  input: { devices: [...] },
  inputSchema,           // checked before the run
  outputSchema,          // checked after
  functions: {           // optional; omit for a pure transform
    listDevices: { handler: async (argument) => db.query(argument), description, parameters, returns },
  },
  limits: { memoryBytes, cpuMs, wallClockMs, maxCalls, maxLogs },
});
// { success, data, error, logs, calls, durationMs }
```

## The guest contract

The code is **the body of a function**: `return` produces the result,
`console.log` records intermediate values. There is no convention guessing — no
`module.exports`, no `export default`, no `main()` — because a sandbox that tries
several and picks one turns a typo into a baffling silence.

`input` is bound as a global. Each registered function is bound as a global under
its own name, so the guest writes `listDevices({ limit: 10 })`.

**The sandbox is synchronous.** Host calls block: the bridge is asyncified, so
QuickJS suspends the entire VM until the host promise settles and hands the value
back directly. No promise ever reaches the guest. This is not a style choice —
driving guest microtasks while a host call is suspended crashes the WASM. Code
using `async`/`await`, or returning a promise, fails with an explanation rather
than a bare syntax error.

## Isolation

No `fetch`, `require`, `process`, `XMLHttpRequest`, `WebSocket`, filesystem or
network. Registered functions are the only route out, and the guest sees only the
ones it was given. `Function()` still exists, but the realm it compiles into is
the sandbox's own.

## Limits

| Limit         | Bounds                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `memoryBytes` | Allocation. Refused at the point of allocation.                                                                                     |
| `cpuMs`       | Time the **guest** spends executing. Host time is subtracted, so a slow registered function cannot starve the code's own allowance. |
| `wallClockMs` | The whole run, host time included.                                                                                                  |
| `maxCalls`    | Host function invocations.                                                                                                          |
| `maxLogs`     | Captured log lines, so a logging loop cannot exhaust host memory.                                                                   |

The wall clock is enforced in two places, not one. The interrupt handler cannot
fire while the VM is suspended in a host call, so a guest looping over slow calls
would otherwise outrun it unnoticed; the bridge therefore refuses calls past the
ceiling, and a run that hit it fails even if the guest caught the refusal and
returned normally.

## Editing code for it

`describeEnvironment({ inputSchema, functions })` emits TypeScript declarations
for exactly what a run binds — `declare const input: …` plus a signature per
function.

`@helix/code-executor/editor` is Monaco already wired to it:

```tsx
<CodeEditor inputSchema={inputSchema} functions={functions} value={code} onChange={setCode} … />
```

Both live here on purpose. The editor's promises and the sandbox's behaviour come
from one description, so author-time completion cannot disagree with what happens
at run time — and a declaration that drifts from the runtime is worse than none.
The editor also silences TS1108 (`return` outside a function), since the code
_is_ a function body.

## Where it runs

QuickJS is WASM, so this works unchanged in Node and in the browser. A caller can
run the same code client-side for an instant preview and server-side for the real
thing.
