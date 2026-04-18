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
    };

export type { SyncSummary };
