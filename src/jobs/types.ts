export type JobStatus = "queued" | "running" | "completed" | "failed" | "dead_letter";

export type Job<TPayload = unknown> = {
  id: string;
  type: string;
  workspaceId: string;
  idempotencyKey: string;
  payload: TPayload;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  traceId: string;
  lastError?: string;
};

export type JobHandler<TPayload> = (job: Job<TPayload>) => Promise<void>;
