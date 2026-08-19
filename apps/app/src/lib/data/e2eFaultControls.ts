export const E2E_BOOKMARK_HYDRATION_DELAY_KEY =
  "serial:e2e-bookmark-hydration-delay-ms";

async function waitForE2EBookmarkHydrationFault() {
  if (
    typeof __SERIAL_E2E_FAULT_CONTROLS__ !== "boolean" ||
    !__SERIAL_E2E_FAULT_CONTROLS__ ||
    typeof sessionStorage === "undefined"
  ) {
    return;
  }
  const delay = Number(
    sessionStorage.getItem(E2E_BOOKMARK_HYDRATION_DELAY_KEY),
  );
  if (!delay || delay <= 0) return;
  sessionStorage.removeItem(E2E_BOOKMARK_HYDRATION_DELAY_KEY);
  await new Promise((resolve) => setTimeout(resolve, delay));
  performance.mark("serial:e2e-bookmark-hydration-released");
}

export const e2eBookmarkHydrationBeforeRead =
  typeof __SERIAL_E2E_FAULT_CONTROLS__ === "boolean" &&
  __SERIAL_E2E_FAULT_CONTROLS__
    ? waitForE2EBookmarkHydrationFault
    : undefined;
