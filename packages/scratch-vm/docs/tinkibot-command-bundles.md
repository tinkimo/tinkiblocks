# Sequential Tinkibot action bundles

The Tinkibot extension groups a contiguous run of two or more eligible robot
commands into one WebSocket request. It waits for the complete response before
Scratch resumes. Single actions and unsafe-to-batch actions retain their existing
individual proxy requests; reporters keep returning values through that path.

## Collection and execution

`src/extensions/tinkimo_tinkibot/bundles/actions.js` declares each robot action's
existing single-command payload builder and terse wire encoder. The extension
marks those command blocks with `supportsBundling` metadata. Reporters, hats and
local operations have no action declaration. Add both a declaration and its
public method delegation when adding a new bundle-capable robot action.

The collector follows only the current thread's `next` links. It stops at the
first unregistered action or unsafe input. It reads literal fields and default
shadow inputs using the VM's existing static-leaf rule: exactly one field, no
inputs, and no executable primitive. It never calls a reporter primitive to
prepare a future command. The first action still receives its arguments from
normal VM evaluation; later literal-only arguments use the same static values.
Payload generation, numeric clamps, note conversion, and terse encoding each
have one declaration used by the action's dispatch path.

After a successful bundle, a per-thread `WeakMap` marks the remaining bundled
blocks as already performed. Scratch traverses them normally and their action
primitives consume those markers without sending again. No stack pointers or
scheduler internals are modified. Loop bodies are collected independently on
each iteration, and branches are selected by Scratch before collection begins.
The existing extension command queue continues to own the response stream.

## Conservative boundaries

These situations retain normal individual execution:

- Reporters and sensors, including a robot reporter plugged into an action input.
- Variable, operator, procedure-parameter, random, and other executable argument
  expressions, even if an expression appears constant. The dynamic action itself
  is a boundary; later literal actions may start a new bundle after it completes.
- Control structures, waits, broadcasts, custom-block calls, and every other
  non-action block. Collection may begin inside their selected branch or body,
  but never traverses that control structure or flattens its iterations.
- Local music operations: rests, tempo changes and tempo reporters. Zero-duration
  notes keep their existing no-op behavior and form a collection boundary.
- Another active non-monitor thread whose reachable blocks can interact with
  the robot. The check follows control branches, reporter inputs and custom-block
  calls to preserve ordering among actively competing robot scripts. Unrelated
  Scratch scripts, inactive hats (including other robot scripts) and visible
  monitors do not disable a contiguous robot-action bundle. A newly triggered
  script queues its requests after an already-dispatched bundle; dormant scripts
  do not reserve a position in the command queue. A stack clicked inside its own
  hat is recognized as belonging to that script, rather than a competitor.
- Timed notes and drums retain a stricter boundary around other non-monitor
  threads and hats, because those scripts can change the shared stage tempo.
  Named sound files such as startup/shutdown have literal inputs and do not need
  that tempo boundary.
- Direct extension/API calls without an executing VM thread, and individual
  commands too large for an envelope. Their original transport behavior and
  limits remain applicable.

User edits during an in-flight physical bundle cannot undo commands already
sent. A new event or external client also cannot preempt a bundle already
executing on the robot. No arbitrary collection delay or debounce timer is used.

Bundles are limited to 32 commands and 4096 UTF-8 bytes of serialized `{cmds}`
payload, matching the firmware protocol. Longer contiguous stacks are split at
those limits. Metadata is excluded from the forwarded robot envelope. An
oversized individual action falls back to its existing individual path rather
than silently truncating text. Command strings, including targeting and interior
whitespace, are retained inside the JSON wrapper.

## Proxy WebSocket interface required

The matching proxy WebSocket entry point is implemented in
[tinkiblocks-proxy PR #23](https://github.com/tinkimo/tinkiblocks-proxy/pull/23).
Deploy it with the editor update before running automatically collected sequences.
The editor changes do not modify proxy or firmware repository files.

A collected request is a JSON object with the firmware's command wrapper and the
existing claim/routing metadata plus a unique correlation ID:

```json
{
  "cmds": [
    {"cmd": "lime.play:startup"},
    {"cmd": "lime.forward:100"},
    {"cmd": "lime.display:happy"},
    {"cmd": "lime.rotate:90"}
  ],
  "requestId": "unique-request-id",
  "nickname": "lime",
  "bot-uuid": "paired-robot-uuid",
  "blocks-uuid": "client-uuid"
}
```

The proxy must recognize `cmds` before its legacy `command` dispatcher, preserve
existing claim/connection handling, and forward `{cmds: [...]}` through the bundle
transport API. It must not interpret Scratch stacks or decide which blocks to
batch. The extension currently selects the existing first paired robot for each
operation; it adds no robot-selection blocks or new robot-addressing policy.
The protocol helper preserves arbitrary original nickname prefixes, including
`all`, and command order; it never deduplicates repeated command strings. Future
mixed-target routing must return one correlated result for every original entry
in source order, aggregating broadcast outcomes at the proxy rather than sending
several partial replies or rewriting command strings in Tinkiblocks.

Return a JSON object whose `requestId` exactly matches the request:

```json
{
  "requestId": "unique-request-id",
  "rsp": [
    {"cmd": "lime.play:startup", "status": "OK", "msg": "OK play\n"},
    {"cmd": "lime.forward:100", "status": "OK", "msg": "OK forward\n"},
    {"cmd": "lime.display:happy", "status": "ERROR", "msg": "ERR original\n"},
    {"cmd": "lime.rotate:90", "status": "NOT_EXECUTED"}
  ]
}
```

`rsp` must contain exactly one entry per original command, including identical
command strings repeated at different positions. Status is `OK`, `ERROR`, or
`NOT_EXECUTED`. `msg` is required for `OK` and `ERROR` and optional for
`NOT_EXECUTED`; preserve its text. Do not join robot responses into a display
string or wrap the response under `value`.

An envelope-level error may be returned as:

```json
{"requestId":"unique-request-id","rsp":[],"error":{"status":"ERROR","msg":"invalid-command-array"}}
```

The existing correlated `{report: "error", value: "...", requestId: "..."}`
WebSocket error shape is also accepted. Legacy command requests and sensor
responses must remain supported. Unsolicited robot/claim/button events keep their
existing shape and must not fulfill a pending bundle request.

## Failure and cancellation behavior

The extension validates the entire response's count, order, command strings,
status values and message types. It then reports any `ERROR` or `NOT_EXECUTED`
through the existing localized command-error alert and rejected-promise path.
It does not infer that later commands failed, require an abort pattern, or resend
commands: a complete response containing `ERROR` followed by `OK` is accepted as a
valid protocol response and the failure is still surfaced. The current companion
firmware happens to fail fast; this client does not impose that policy.

The VM handles rejected commands using its existing behavior. In particular,
failed music commands retain their originating-thread retirement behavior, even
when the failed music action is not the first action in a bundle. Failure paths
do not leave skip markers for a later loop iteration.

Malformed JSON, incomplete/mismatched responses, socket failure/close and selected
robot disconnection reject the pending operation and free the command queue.
Connection establishment has a 30-minute limit in `bundles/protocol.js`.
The bundled-response wait adds all declared note/drum durations to that 30-minute
transport margin, so a valid sequence of long musical actions is not timed out
merely because their durations add up. The separate proxy handler must also
allow sequential music duration rather than reusing its short individual-command
timeout. These timers prevent permanent suspension and do not control bundle
formation. Successful/error completion clears the response timer.
Correlation IDs prevent a delayed response from satisfying a later request.
Movement and other non-idempotent commands are never retried or automatically
resent individually after a protocol failure. A queued bundle whose script was
stopped before dispatch is not sent; once transmitted, cancellation still depends
on existing robot stop behavior.

## Validation

`test/unit/extension_tinkibot_bundles.js` exercises real VM threads and block
containers for contiguous actions, exactly-once traversal, reports and nested
robot reporters, variables/operators, waits, repeat iterations, if/else selection,
concurrent scripts and future hats, cache refreshes, music errors, command-count
limits, malformed responses, disconnects, stale correlation and deterministic
timeouts. Existing extension and general VM tests remain applicable.

Run from `packages/scratch-vm`:

```sh
../../node_modules/.bin/tap --disable-coverage test/unit/extension_tinkibot_bundles.js
npm run tap -- --disable-coverage
npm run lint
npm run build
```

Hardware end-to-end testing requires the separately updated proxy WebSocket
handler, matching robot/modem firmware, and physical devices. The host tests do
not establish wireless delivery or motor timing.
