# Moderation Operations

Admin moderation operations expose bounded, review-only workflows:

- **Duplicate report clusters** compare pending reports from at most 250 recent
  records. A cluster requires the same confession, report type, and normalized
  reason. Results identify report IDs and the matching signal; no report is
  resolved, merged, or otherwise changed.
- **Shadow evaluation** runs the local offline scorer against at most 250
  checked-in fixtures. It stores transition counts and average scoring latency,
  never sends fixture content to a moderation provider, and never changes live
  decisions.
- **Policy previews** show up to 100 representative moderation-log IDs whose
  offline score would change status under proposed thresholds. A preview is
  actor-bound, expires after ten minutes, and must be explicitly approved.
  Applying a preview stores the prior thresholds for guarded rollback. Rollback
  is refused if the active policy has since changed.
- **Sensitive queue grants** are scoped to `sensitive_queue`, issued by an
  admin to a moderator, and expire within twelve hours. Queue access is denied
  when the moderator has no active, unexpired grant. A newer grant revokes the
  moderator's prior grants for that scope. Expired grants are marked expired
  when access is attempted.

Operations are persisted in `moderation_operations` and audit events record the
actor, operation, scope, expiry, and aggregate outcome. Existing moderation
decisions and report records remain unchanged by preview, evaluation, and
clustering. Operation and audit rows remain available for operational
traceability; this change adds no automatic retention cleanup. Previews expire
after ten minutes, and grants expire within twelve hours, but their historical
rows are retained.
