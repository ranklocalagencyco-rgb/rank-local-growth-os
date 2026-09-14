// Minimal long-running worker: repeatedly asks the app to process one bounded batch of jobs.
// Run with: npm run worker   (reads .env.local when present)
// Replace with a Trigger.dev or platform cron trigger later; the app-side contract is the same.

const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.JOB_RUNNER_SECRET;
const idlePollMs = Number(process.env.JOB_WORKER_POLL_MS || 5000);
const workerId = `worker-${process.pid}`;

if (!secret) {
  console.error("JOB_RUNNER_SECRET is required to run the worker.");
  process.exit(1);
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(JSON.stringify({ level: "info", message: "worker.start", appUrl, workerId, idlePollMs }));

while (!stopping) {
  let delay = idlePollMs;
  try {
    const response = await fetch(`${appUrl}/api/jobs/run?limit=5`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-worker-id": workerId },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(JSON.stringify({ level: "error", message: "worker.batch_failed", status: response.status, body }));
    } else {
      const claimed = body.claimed ?? 0;
      console.log(JSON.stringify({ level: "info", message: "worker.batch", claimed, completed: body.completed, continued: body.continued, failed: body.failed, deadLettered: body.deadLettered, purgedCandidates: body.purgedCandidates }));
      if (claimed > 0) delay = 250;
    }
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "worker.unreachable", error: error instanceof Error ? error.message : String(error) }));
  }
  await sleep(delay);
}

console.log(JSON.stringify({ level: "info", message: "worker.stop" }));
