/* Keeps a throwaway MongoDB available for `npm run dev`.

   The compose stack deliberately does not publish Mongo to the host, so local
   development gets its own container on 27017. This starts it if it is missing,
   reuses it if it is already there, and then idles so `concurrently` keeps the
   process in its group (Ctrl-C stops the dev session, not the database). */

import { spawn, spawnSync } from "node:child_process";

const CONTAINER = "coyv-mongo-dev";
const IMAGE = "mongo:7";
const PORT = "27017";

const run = (args) => spawnSync("docker", args, { encoding: "utf8" });

const docker = run(["version", "--format", "{{.Server.Version}}"]);
if (docker.status !== 0) {
  console.error(
    "[db] Docker is not running. Start Docker Desktop, or set MONGODB_URI in\n" +
      "     server/.env to point at a MongoDB you already have.",
  );
  process.exit(1);
}

const state = run([
  "ps",
  "-a",
  "--filter",
  `name=^/${CONTAINER}$`,
  "--format",
  "{{.State}}",
]).stdout.trim();

if (state === "running") {
  console.log(`[db] ${CONTAINER} already running on ${PORT}`);
} else {
  const result =
    state === ""
      ? run(["run", "-d", "--name", CONTAINER, "-p", `${PORT}:27017`, IMAGE])
      : run(["start", CONTAINER]);

  if (result.status !== 0) {
    console.error(`[db] could not start ${CONTAINER}:\n${result.stderr.trim()}`);
    process.exit(1);
  }
  console.log(`[db] ${CONTAINER} listening on ${PORT}`);
}

/* Wait for the server to accept connections so the API's first connect
   attempt does not race the container's startup. */
for (let attempt = 0; attempt < 30; attempt += 1) {
  const ping = run([
    "exec",
    CONTAINER,
    "mongosh",
    "--quiet",
    "--eval",
    "db.adminCommand('ping').ok",
  ]);
  if (ping.status === 0 && ping.stdout.includes("1")) break;
  spawnSync("sleep", ["1"]);
}

console.log("[db] ready");

/* Idle in the foreground; the container keeps running between sessions. */
const idle = spawn("tail", ["-f", "/dev/null"], { stdio: "ignore" });
const stop = () => {
  idle.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
