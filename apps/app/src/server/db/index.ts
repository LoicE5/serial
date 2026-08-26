import { createClient } from "@libsql/client";
// import { getTableName, is, Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "../../env";
import * as schema from "./schema";
// import type { Client } from "@libsql/client";

// const TABLE_NAMES = Object.values(schema)
//   .filter((value) => is(value, Table))
//   .map((table) => getTableName(table as Table));

// function extractTables(sql: string): string[] {
//   const tables: string[] = [];
//   for (const table of TABLE_NAMES) {
//     if (sql.includes(`"${table}"`) || sql.includes(` ${table}`)) {
//       tables.push(table.replace("serial_", ""));
//     }
//   }
//   return tables;
// }

// function createLoggingClient(client: Client): Client {
//   return new Proxy(client, {
//     get(target, prop, receiver) {
//       const value = Reflect.get(target, prop, receiver);

//       if (prop === "execute") {
//         return async (stmt: Parameters<Client["execute"]>[0]) => {
//           const sql =
//             typeof stmt === "string"
//               ? stmt
//               : ((stmt as { sql: string | undefined }).sql ?? "");
//           const start = performance.now();
//           const result = await target.execute(stmt);
//           const duration = performance.now() - start;
//           const tables = extractTables(sql);

//           console.log(
//             `[DB] ${tables.join(", ")} | ${duration.toFixed(2)}ms | ${result.rows.length} rows`,
//           );

//           return result;
//         };
//       }

//       return value;
//     },
//   });
// }

const client = createClient({
  url: env.DATABASE_URL,
  authToken: env.DATABASE_AUTH_TOKEN,
  // Hosted Turso enforces no server-side concurrency limit, so disable the
  // client's internal request queue (default 20) and let dbSemaphore be the
  // only throttle. Local libsql-server keeps the default queue as a backstop
  // for its small internal connection pool.
  concurrency: env.DATABASE_URL.includes(".turso.io") ? 0 : undefined,
});

// export const client = createLoggingClient(baseClient);

export const db = drizzle({ client, schema });
