-- Inngest observability retention sweep (run hourly by the `inngest-cleanup`
-- sidecar). The self-hosted Inngest server never prunes its trace/history
-- tables, so they grow without bound (spans+history+traces were ~1.2 GB).
--
-- What the Helix run-history UI actually reads (Inngest v1.17.4, with
-- preview=false → LegacyRunTraceLoader / LegacyGetSpanOutput, see
-- web/packages/workflow/helix-workflow-plugins/src/runs):
--   * trace_runs  — the run list      (GetRuns / run)
--   * traces      — the trace tree + step output (legacy trace loader)
--   * events      — trigger payloads   (eventV2)
-- Those three are kept for 7 DAYS so run history stays intact for a week.
--
-- The `spans` table (the preview=true OTEL path) and the legacy `history`
-- table are NOT read by the UI, so they are trimmed to 24 HOURS.
--
-- Safety: in-flight runs (trace_runs.ended_at IS NULL or 0) are never touched,
-- whatever their age, so a long-sleeping run's trace is never half-deleted.
-- `ended_at` is stored as epoch MILLISECONDS (bigint).

-- 24h — spans (preview/OTEL path, unused by the UI). Keep in-flight runs' spans.
DELETE FROM spans s
 WHERE s.start_time < now() - interval '24 hours'
   AND NOT EXISTS (
     SELECT 1 FROM trace_runs tr
      WHERE tr.run_id = s.run_id AND (tr.ended_at IS NULL OR tr.ended_at = 0)
   );

-- 24h — legacy v1 history (unused by the UI).
DELETE FROM history
 WHERE created_at < now() - interval '24 hours';

-- 7d — traces (the run-history trace tree the UI reads). Keep in-flight runs.
DELETE FROM traces t
 WHERE t."timestamp" < now() - interval '7 days'
   AND NOT EXISTS (
     SELECT 1 FROM trace_runs tr
      WHERE tr.run_id = t.run_id AND (tr.ended_at IS NULL OR tr.ended_at = 0)
   );

-- 7d — events (trigger payloads shown alongside run history).
DELETE FROM events
 WHERE received_at < now() - interval '7 days';

-- 7d — trace_runs (the run list). Deleted last so the joins above still see
-- ended_at. Only finished runs older than 7 days; in-flight runs are kept.
DELETE FROM trace_runs
 WHERE ended_at IS NOT NULL AND ended_at <> 0
   AND ended_at < (extract(epoch FROM now())::bigint - 7 * 86400) * 1000;
