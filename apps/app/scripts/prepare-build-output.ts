import fs from "node:fs";
import path from "node:path";
import { getBuildOutput } from "./build-output";

const INSTRUMENTATION_SOURCE = "instrument.server.mjs";
const { publicDirectory, serverDirectory } = getBuildOutput();

if (!fs.existsSync(publicDirectory)) {
  throw new Error(`Build output directory does not exist: ${publicDirectory}`);
}

if (serverDirectory) {
  if (!fs.existsSync(serverDirectory)) {
    throw new Error(
      `Server output directory does not exist: ${serverDirectory}`,
    );
  }

  const instrumentationDestination = path.join(
    serverDirectory,
    path.basename(INSTRUMENTATION_SOURCE),
  );
  fs.copyFileSync(INSTRUMENTATION_SOURCE, instrumentationDestination);
  console.log(`Copied server instrumentation to ${instrumentationDestination}`);
} else {
  // Vercel invokes Nitro's generated function entry instead of the package's
  // start command. Server-side Sentry initialization is bundled via src/start.ts.
  console.log("Using the bundled server entry for the Vercel build output");
}
