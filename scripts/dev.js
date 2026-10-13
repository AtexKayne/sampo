const { spawn } = require("node:child_process");

const scripts = ["dev:server", "dev:client"];
const children = scripts.map((script) =>
  spawn("npm", ["run", script], { stdio: "inherit", shell: true }),
);

let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.killed) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", shell: true });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 200);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code) stop(code);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
