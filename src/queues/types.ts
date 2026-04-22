import type { SyncSummary } from "../services/calendarSync";

export type SyncJob =
  | {
      type: "incremental";
      userId: string;
      calendarId: string;
      reason: "webhook" | "cron" | "manual" | "onboarding";
      enqueuedAt: number;
    }
  | {
      type: "full_resync";
      userId: string;
      calendarId: string;
      reason: "410-recovery" | "bootstrap" | "manual";
      enqueuedAt: number;
      pageToken?: string;
      // Chunked continuations must carry the original window so every page of
      // the same full_resync sees identical query parameters. Google rejects /
      // behaves inconsistently when a pageToken is paired with different
      // timeMin/timeMax than the first call.
      timeMin?: string;
      timeMax?: string;
    }
  | {
      // §5 후속 B — rule-deletion rollback. Enqueued by DELETE
      // /api/categories/:id, one message per calendar. The consumer
      // clears app-owned color overrides whose `autocolor_category`
      // marker matches `categoryId`. Does NOT touch `nextSyncToken` and
      // does NOT take the sync claim — rollback is orthogonal to
      // incremental/full_resync and serializes per-event via Google's
      // last-writer-wins PATCH.
      type: "color_rollback";
      userId: string;
      calendarId: string;
      categoryId: string;
      enqueuedAt: number;
    };

export type { SyncSummary };
