const PROBE_TIMEOUT_MS = 120_000;

export default async function waitForCancellation() {
  console.log("SERIAL_E2E_CLEANUP_READY");
  await new Promise((resolve) => setTimeout(resolve, PROBE_TIMEOUT_MS));
  throw new Error("E2E cleanup probe was not cancelled within two minutes.");
}
