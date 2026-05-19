import { spawn } from "child_process";

const baseEnv = { ...process.env };
const backendEnv = {
  ...baseEnv,
  SERVER_PORT: baseEnv.SERVER_PORT || baseEnv.BACKEND_PORT || "5174",
};
const frontendEnv = {
  ...baseEnv,
  PORT: baseEnv.FRONTEND_PORT || baseEnv.PORT || "5173",
};

const backend = spawn("npm", ["run", "dev:server"], { stdio: "inherit", shell: true, env: backendEnv });
const frontend = spawn("npm", ["run", "dev:frontend"], { stdio: "inherit", shell: true, env: frontendEnv });

const cleanup = () => {
  if (!backend.killed) backend.kill();
  if (!frontend.killed) frontend.kill();
  process.exit();
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

backend.on("exit", (code) => {
  if (code !== 0) {
    console.error(`Backend exited with code ${code}`);
    cleanup();
  }
});

frontend.on("exit", (code) => {
  if (code !== 0) {
    console.error(`Frontend exited with code ${code}`);
    cleanup();
  }
});
