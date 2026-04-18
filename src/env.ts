import type { SyncJob } from "./queues/types";

export type Bindings = {
  ENV: "dev" | "prod";
  GOOGLE_OAUTH_REDIRECT_URI: string;

  // Optional because the prod worker is a URL-reserving shell that does not
  // yet have a Hyperdrive binding. `getDb` throws a clear error if a caller
  // tries to use the DB in an environment where it is not configured.
  HYPERDRIVE?: Hyperdrive;

  // Queue producer. Absent in the prod shell until Queue bindings are added;
  // producer code must check for presence.
  SYNC_QUEUE?: Queue<SyncJob>;

  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GAS_REDIRECT_URL: string;
  TOKEN_ENCRYPTION_KEY: string;
  SESSION_HMAC_KEY: string;
  SESSION_PEPPER: string;

  // Base URL used as the `address` when registering a Google Calendar Watch
  // channel. Optional because Google distrusts *.workers.dev and will reject
  // registration against the dev shell — dev environments leave it unset,
  // which makes `/sync/bootstrap` skip channel registration entirely. Prod
  // sets this to the verified custom domain (§1 prerequisite).
  WEBHOOK_BASE_URL?: string;
};

export type Variables = {
  reqId: string;
  userId: string;
  email: string;
};

export type HonoEnv = { Bindings: Bindings; Variables: Variables };
