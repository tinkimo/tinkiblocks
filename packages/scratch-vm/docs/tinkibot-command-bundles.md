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
- Timed notes and drums retain a stricter boundary around other active non-monitor
  threads that can change the shared stage tempo. Inactive hats, including melody
  handlers containing a tempo setter, do not disable bundling. Each bundle captures
  tempo at dispatch; a later tempo change affects the next bundle.
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

## Public WebSocket interface

`api.js` centrally converts internal Scratch payloads into public commands with
string parameters. Move/rotate/display use `forward` or `reverse`, signed
`angle`, and `display` respectively. Every request carries `request-id`,
`client-uuid` and authoritative `bot-uuid`; nickname is optional advisory data.
The previous local-storage UUID entry is retained during migration.

```json
{"request-id":"c94c0c75-223a-4f8e-a7ec-175c56d70215","client-uuid":"39da85c3-0aea-4250-88b5-478e01223eed","bot-uuid":"c1c4bd43-16cc-4f99-9297-186614d4e33f","cmds":[{"command":"forward","distance":"10"},{"command":"rotate","angle":"90"}]}
```

The proxy resolves UUIDs, sends one compact robot request and returns ordered
`rsp` objects containing the original public command/parameters, `status`,
`message` and (when executed) `value`. Single responses carry these fields at
the top level. Public responses must match request, robot and client identities.
Internal command strings never leave the editor over WebSocket. See
[the public API guide](https://github.com/tinkimo/tinkiblocks-proxy/blob/feat/unified-json-api/docs/websocket-api.md)
for schemas, registration, examples and deployment order.

Malformed JSON, incomplete/mismatched responses, socket failure/close and selected
robot disconnection reject the pending operation and free the command queue.
Connection establishment has a 30-minute limit in `bundles/protocol.js`.
For music-only bundles, the response deadline is the declared total duration plus
five seconds per command and a ten-second allowance beyond the proxy deadline.
Other bundles retain the 30-minute transport margin plus declared music time.
A missing reply rejects the operation, retires the originating music thread and
releases the command queue without replaying notes. Successful/error completion
clears the response timer. Firmware stops audio and reports an error when an I2S
write completion callback has not arrived within two seconds.
Correlation IDs prevent a delayed response from satisfying a later request.
Movement and other non-idempotent commands are never retried or automatically
resent individually after a protocol failure. A queued bundle whose script was
stopped before dispatch is not sent; once transmitted, cancellation still depends
on existing robot stop behavior.

## Validation

`test/unit/extension_tinkibot_bundles.js` exercises real VM threads and block
containers for contiguous actions, exactly-once traversal, reports and nested
robot reporters, variables/operators, waits, repeat iterations, if/else selection,
concurrent scripts and inactive tempo hats, cache refreshes, music errors, command-count
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

For a repeat body containing snare, bass, rest, hi-hat, rest, the snare and bass
form one two-command bundle per iteration. Each rest remains a local Scratch wait;
the isolated hi-hat uses an individual request. Iterations are never flattened.
