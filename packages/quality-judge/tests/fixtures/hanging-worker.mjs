import { parentPort } from "node:worker_threads";

if (parentPort === null) throw new Error("fixture worker requires a parent port");
parentPort.on("message", () => {
  for (;;) {
    // Purpose-written hostile fixture: the parent must terminate this worker.
  }
});
parentPort.postMessage({ type: "ready" });
