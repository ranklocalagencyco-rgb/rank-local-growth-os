import { existsSync } from "node:fs";
import { hostname } from "node:os";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

const { runJobBatch } = await import("@/jobs/runtime");

const workerId = `${hostname()}:${process.pid}`;
const idleDelayMs = Number(process.env.WORKER_IDLE_DELAY_MS ?? 3000);
const once = process.argv.includes("--once");
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

console.log(JSON.stringify({ level: "info", message: "worker.started", workerId, once }));

while (!stopping) {
  try {
    const result = await runJobBatch(workerId, 5);
    if (result.claimed > 0) console.log(JSON.stringify({ level: "info", message: "worker.batch", workerId, ...result }));
    if (once) break;
    if (result.claimed === 0) await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "worker.batch_failed", workerId, error: error instanceof Error ? error.message : "unknown" }));
    if (once) process.exit(1);
    await new Promise((resolve) => setTimeout(resolve, idleDelayMs * 2));
  }
}

console.log(JSON.stringify({ level: "info", message: "worker.stopped", workerId }));
