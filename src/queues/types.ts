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
    };

export type { SyncSummary };
