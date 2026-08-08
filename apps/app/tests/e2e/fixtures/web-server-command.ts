export const E2E_SERVER_PROCESS_GROUP_MARKER =
  "SERIAL_E2E_SERVER_PROCESS_GROUP";
export const E2E_SERVER_PROCESS_GROUP_FILE =
  "SERIAL_E2E_SERVER_PROCESS_GROUP_FILE";

export function supervisedWebServerCommand(command: string) {
  return (
    `if [ -n "$${E2E_SERVER_PROCESS_GROUP_FILE}" ]; then ` +
    `echo $$ >> "$${E2E_SERVER_PROCESS_GROUP_FILE}"; fi; exec ${command}`
  );
}
