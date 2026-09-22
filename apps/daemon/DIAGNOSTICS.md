# Automatic fault diagnostics (OPEND-3397)

The daemon observes Run errors, failed terminal fallbacks, automatic/model retries,
OD Next `blocked` outcomes, and chat/resume admission errors. Its existing desktop
observability route also captures renderer/child-process crashes, unclean exits and
packaged startup failures. Fatal daemon handlers synchronously register evidence;
active Run markers recover daemon interruptions on restart. Ordinary cancellation
and successful terminal callbacks do not create incidents. An error followed by
its terminal callback is one fault; independent error events keep their identities.

This is background behavior controlled by the existing metrics/content preferences,
including their shared UI/CLI configuration path. No new interactive capability,
Vela role, query service, or download endpoint is introduced. Manual diagnostics
exports include `summary/automatic-log-upload.json` with queue states and loss reasons.
All daemon-owned paths derive from the resolved data root; see the root `AGENTS.md`
**Daemon data directory contract** for ownership and launch propagation.

## Delivery and privacy

`storage/diagnostic-outbox.ts` owns an independent SQLite incident queue with leases
and version checks. Same source IDs deduplicate, stale callbacks cannot overwrite
new outcomes, and upload receipts persist before content is considered delivered.
Recovery updates the same incident's `recoveredAt`; already captured chunks remain
unchanged and the relay writes a new immutable manifest generation.

`packages/diagnostics` writes a gzip JSONL archive as at-most-4-MiB chunks. Text is
redacted before compression. Native dumps, binary attachments, environment dumps
and unrelated agents' CLI logs are excluded. The incident Run is selected explicitly;
host text logs and that agent's log tails supplement it. Missing/truncated sources
are reported as partial. Fault summaries include version/runtime context.

Both metrics and content must be true at registration and each transport step.
Malformed preferences fail closed. Disabling cancels transport, clears pending
content and invalidates its leases. File watermarks prevent a later opt-in from
uploading old text; an old source whose boundary cannot be proved is omitted and
marked partial. Already transmitted remote bytes expire under the remote policy.

Pending content expires after 7 days; delivered local content after 24 hours. The
queue budgets payloads plus serialized metadata within 1 GiB, reserving 100 MiB
before collection. Old delivered copies go first, then oldest pending incidents.
Collection uses a 96-MiB raw envelope budget and checks compressed output against
100 MiB. Small loss counters and at most 1024 recent scrubbed tombstones retain
eviction reasons without an unbounded content queue. SQLite allocation/WAL overhead
is separate from the content budget. Disk/DB failures leave a host warning; hard
OOM, disk failure, permanent offline devices and silent unrecognized faults cannot
be guaranteed lossless.

`integrations/diagnostic-relay.ts` derives the relay origin from the existing object
or telemetry URL. It needs no Run registration, login, Vela token or Langfuse trace.
Device credentials are local mode-0600 files. Backoff honors `Retry-After`; each retry
gets a fresh short-lived grant and preserves incident/chunk identities. Losing a
previously bound device identity fails explicitly instead of claiming the old scope.
Completed object references go to existing observability; telemetry failure does not
block R2 delivery. These records do not change the Run SLO success calculation.

## Validation and rollout

Focused tests cover durable dedupe/restart, stale leases, consent revocation and
re-enabling, corrupt preferences, recovery outcomes, byte/age pruning, no-run delivery,
and a lost completion receipt. The Worker contract is maintained in
[open-design-telemetry-worker](https://code.powerformer.net/core/open-design-telemetry-worker),
whose `DIAGNOSTICS.md` contains the verified wrangler download/reassembly commands.

Before releasing a client, enable and validate the compatible Worker with a
prefix-scoped 30-day R2 lifecycle rule. Its production switch remains disabled in
the change until the existing CUTOVER process authorizes activation. Dry-run builds
and in-memory R2 tests are not real cloud or macOS/Windows packaged acceptance.
