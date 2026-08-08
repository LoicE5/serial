import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  E2E_SERVER_PROCESS_GROUP_FILE,
  E2E_SERVER_PROCESS_GROUP_MARKER,
} from "../tests/e2e/fixtures/web-server-command";

const GRACEFUL_SHUTDOWN_MS = 5_000;
const FORCED_SHUTDOWN_MS = 2_000;
const PROCESS_POLL_MS = 50;
const PARENT_POLL_MS = 100;
const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type ShutdownReason =
  | { type: "child-exit"; exit: ChildExit }
  | { type: "signal"; signal: NodeJS.Signals }
  | { type: "parent-death" };

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMissingProcess(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ESRCH";
}

function isProcessGroupAlive(processGroupId: number) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    throw error;
  }
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

const [launcherPidArgument, config, ...playwrightArguments] =
  process.argv.slice(2);
const launcherPid = Number(launcherPidArgument);
if (!Number.isInteger(launcherPid) || launcherPid <= 0 || !config) {
  console.error(
    "Usage: supervise-e2e.ts <launcher pid> <playwright config> [...playwright args]",
  );
  process.exit(1);
}

if (process.platform === "win32") {
  console.error("The E2E process supervisor requires POSIX process groups.");
  process.exit(1);
}

if (process.ppid !== launcherPid) {
  process.exit(1);
}

const processGroupDirectory = mkdtempSync(
  join(tmpdir(), "serial-e2e-process-groups-"),
);
const processGroupFile = join(processGroupDirectory, "groups");
const playwright = spawn(
  "pnpm",
  ["exec", "playwright", "test", "--config", config, ...playwrightArguments],
  {
    detached: true,
    env: {
      ...process.env,
      [E2E_SERVER_PROCESS_GROUP_FILE]: processGroupFile,
    },
    stdio: "inherit",
  },
);
const spawnedProcessId = playwright.pid;
if (spawnedProcessId === undefined) {
  throw new Error("Failed to start the Playwright process group.");
}
const processGroupId: number = spawnedProcessId;

console.log(`SERIAL_E2E_PROCESS_GROUP=${processGroupId}`);

const trackedProcessGroups = new Set([processGroupId]);
let activeShutdownSignal: NodeJS.Signals | undefined;

function readRegisteredProcessGroups() {
  let contents = "";
  try {
    contents = readFileSync(processGroupFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const value of contents.split("\n")) {
    const registeredProcessGroup = Number(value);
    if (
      !Number.isInteger(registeredProcessGroup) ||
      registeredProcessGroup <= 0 ||
      trackedProcessGroups.has(registeredProcessGroup)
    ) {
      continue;
    }
    trackedProcessGroups.add(registeredProcessGroup);
    console.log(`${E2E_SERVER_PROCESS_GROUP_MARKER}=${registeredProcessGroup}`);
    if (activeShutdownSignal) {
      signalProcessGroup(registeredProcessGroup, activeShutdownSignal);
    }
  }
}

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
}

let resolveChildExit!: (exit: ChildExit) => void;
const childExit = new Promise<ChildExit>((resolve) => {
  resolveChildExit = resolve;
});
playwright.once("exit", (code, signal) => resolveChildExit({ code, signal }));

let shutdownPromise: Promise<void> | undefined;
const signalHandlers = new Map<NodeJS.Signals, () => void>();

const parentWatch = setInterval(() => {
  if (process.ppid !== launcherPid) {
    void startShutdown({ type: "parent-death" });
  }
}, PARENT_POLL_MS);
const processGroupWatch = setInterval(
  readRegisteredProcessGroups,
  PROCESS_POLL_MS,
);

process.once("disconnect", () => {
  void startShutdown({ type: "parent-death" });
});

function signalTrackedProcessGroups(signal: NodeJS.Signals) {
  for (const trackedProcessGroup of trackedProcessGroups) {
    signalProcessGroup(trackedProcessGroup, signal);
  }
}

async function waitForTrackedProcessGroupsExit(timeoutMilliseconds: number) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    readRegisteredProcessGroups();
    if (
      [...trackedProcessGroups].every(
        (trackedProcessGroup) => !isProcessGroupAlive(trackedProcessGroup),
      )
    ) {
      return true;
    }
    await delay(PROCESS_POLL_MS);
  }
  return [...trackedProcessGroups].every(
    (trackedProcessGroup) => !isProcessGroupAlive(trackedProcessGroup),
  );
}

async function cleanProcessGroups(initialSignal: NodeJS.Signals) {
  activeShutdownSignal = initialSignal;
  readRegisteredProcessGroups();
  signalTrackedProcessGroups(initialSignal);
  if (await waitForTrackedProcessGroupsExit(GRACEFUL_SHUTDOWN_MS)) {
    return true;
  }

  console.error(
    `E2E process groups did not exit after ${initialSignal}; forcing shutdown.`,
  );
  activeShutdownSignal = "SIGKILL";
  signalTrackedProcessGroups("SIGKILL");
  return waitForTrackedProcessGroupsExit(FORCED_SHUTDOWN_MS);
}

function removeLifecycleHandlers() {
  clearInterval(parentWatch);
  clearInterval(processGroupWatch);
  rmSync(processGroupDirectory, { force: true, recursive: true });
  if (process.connected) process.disconnect?.();
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}

function finishWithSignal(signal: NodeJS.Signals) {
  removeLifecycleHandlers();
  process.kill(process.pid, signal);
}

async function performShutdown(reason: ShutdownReason) {
  const initialSignal = reason.type === "signal" ? reason.signal : "SIGTERM";
  const groupExited = await cleanProcessGroups(initialSignal);
  await Promise.race([childExit, delay(FORCED_SHUTDOWN_MS)]);

  if (!groupExited) {
    console.error("One or more E2E process groups survived SIGKILL.");
    removeLifecycleHandlers();
    process.exitCode = 1;
    return;
  }

  if (reason.type === "signal") {
    finishWithSignal(reason.signal);
    return;
  }

  if (reason.type === "parent-death") {
    removeLifecycleHandlers();
    process.exitCode = 1;
    return;
  }

  if (reason.exit.signal) {
    finishWithSignal(reason.exit.signal);
  } else {
    removeLifecycleHandlers();
    process.exitCode = reason.exit.code ?? 1;
  }
}

function startShutdown(reason: ShutdownReason) {
  shutdownPromise ??= performShutdown(reason).catch((error) => {
    console.error(error);
    removeLifecycleHandlers();
    process.exitCode = 1;
  });
  return shutdownPromise;
}

for (const signal of forwardedSignals) {
  const handler = () => void startShutdown({ type: "signal", signal });
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

void childExit.then((exit) => startShutdown({ type: "child-exit", exit }));

if (process.connected) {
  process.send?.({ type: "ready" });
}
