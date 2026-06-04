import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const nextBin = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");

const host = process.env.PUBLIC_HOST?.trim() || "127.0.0.1";
const requestedPort =
  process.env.PUBLIC_PORT?.trim() || process.env.PORT?.trim() || "3000";
let port = requestedPort;
let localUrl = `http://${host}:${port}`;
const cloudflaredBin = process.env.CLOUDFLARED_BIN?.trim() || "cloudflared";
const tryCloudflareUrlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

let nextProcess = null;
let tunnelProcess = null;
let shuttingDown = false;

function info(message = "") {
  console.log(`[public] ${message}`);
}

function error(message = "") {
  console.error(`[public] ${message}`);
}

function printCloudflaredInstallHint() {
  error("cloudflared is not installed or is not available in PATH.");
  console.error("");
  console.error("Install it once, then reopen your terminal:");
  console.error("  winget install --id Cloudflare.cloudflared");
  console.error("");
  console.error("Official downloads:");
  console.error("  https://developers.cloudflare.com/tunnel/downloads/");
  console.error("");
  console.error("After installation, run:");
  console.error("  npm.cmd run public");
}

function waitForExit(child, name) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${name} exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}.`
        )
      );
    });
  });
}

async function ensureCloudflared() {
  const child = spawn(cloudflaredBin, ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForExit(child, "cloudflared --version");
  } catch {
    printCloudflaredInstallHint();
    throw new Error("Install cloudflared and rerun npm.cmd run public.");
  }
}

function isPortAvailable(candidatePort) {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (serverError) => {
      if (serverError?.code === "EADDRINUSE" || serverError?.code === "EACCES") {
        resolve(false);
        return;
      }

      reject(serverError);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(candidatePort, host);
  });
}

async function configureLocalEndpoint() {
  const parsedPort = Number.parseInt(requestedPort, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid public port: ${requestedPort}`);
  }

  let candidatePort = parsedPort;
  for (let attempt = 0; attempt < 50 && candidatePort <= 65535; attempt += 1) {
    if (await isPortAvailable(candidatePort)) {
      port = String(candidatePort);
      localUrl = `http://${host}:${port}`;
      if (port !== requestedPort) {
        info(`Port ${requestedPort} is busy; using ${port} instead.`);
      }
      return;
    }

    candidatePort += 1;
  }

  throw new Error(`No free local port found near ${requestedPort}.`);
}

async function runNextBuild() {
  if (!existsSync(nextBin)) {
    throw new Error("Next.js CLI was not found. Run npm.cmd install first.");
  }

  info("Building the production app...");

  const child = spawn(process.execPath, [nextBin, "build"], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });

  await waitForExit(child, "next build");
}

function stopChild(child, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  info(`Stopping ${name}...`);
  child.kill("SIGINT");

  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }, 2500).unref();
}

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (reason) {
    info(reason);
  }

  stopChild(nextProcess, "Next.js");
  stopChild(tunnelProcess, "cloudflared");

  setTimeout(() => {
    process.exit(exitCode);
  }, 300).unref();
}

function attachUnexpectedExit(child, name) {
  child.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const description = signal
      ? `${name} stopped with signal ${signal}.`
      : `${name} stopped with code ${code ?? "unknown"}.`;
    shutdown(description, code === 0 ? 0 : 1);
  });

  child.once("error", (processError) => {
    if (!shuttingDown) {
      error(`${name} failed: ${processError.message}`);
      shutdown("", 1);
    }
  });
}

function startNext(publicUrl) {
  info(`Starting Next.js on ${localUrl}`);
  info(`APP_BASE_URL=${publicUrl}`);

  let printedReadyLink = false;

  nextProcess = spawn(process.execPath, [nextBin, "start", "-H", host, "-p", port], {
    cwd: rootDir,
    env: {
      ...process.env,
      APP_BASE_URL: publicUrl,
      NODE_ENV: "production",
    },
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });

  attachUnexpectedExit(nextProcess, "Next.js");

  const printReadyLink = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);

    if (!printedReadyLink && /ready|started|local:/i.test(text)) {
      printedReadyLink = true;
      info("");
      info("Public URL:");
      console.log(publicUrl);
      info("Keep this terminal open while you use the site. Press Ctrl+C to stop.");
    }
  };

  nextProcess.stdout.on("data", printReadyLink);
  nextProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
}

function startTunnel() {
  info(`Starting Cloudflare Quick Tunnel to ${localUrl}`);

  tunnelProcess = spawn(cloudflaredBin, ["tunnel", "--url", localUrl], {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  attachUnexpectedExit(tunnelProcess, "cloudflared");

  let startedNext = false;
  let bufferedOutput = "";

  const handleTunnelOutput = (chunk, stream) => {
    const text = chunk.toString();
    stream.write(text);

    if (startedNext) {
      return;
    }

    bufferedOutput += text;
    const publicUrl = bufferedOutput.match(tryCloudflareUrlPattern)?.[0];
    if (!publicUrl) {
      return;
    }

    startedNext = true;
    info("");
    info("Cloudflare tunnel URL detected:");
    console.log(publicUrl);
    startNext(publicUrl);
  };

  tunnelProcess.stdout.on("data", (chunk) => handleTunnelOutput(chunk, process.stdout));
  tunnelProcess.stderr.on("data", (chunk) => handleTunnelOutput(chunk, process.stderr));
}

process.on("SIGINT", () => shutdown("Received Ctrl+C.", 0));
process.on("SIGTERM", () => shutdown("Received termination signal.", 0));

try {
  await ensureCloudflared();
  await configureLocalEndpoint();
  await runNextBuild();
  startTunnel();
} catch (caughtError) {
  if (caughtError instanceof Error) {
    error(caughtError.message);
  } else {
    error(String(caughtError));
  }

  process.exit(1);
}
