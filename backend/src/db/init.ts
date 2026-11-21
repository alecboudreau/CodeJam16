// `npm run db:init`: creates the tables in Supabase Postgres (safe to run again).
import { closeDb, initDb } from "./db";

await initDb();
console.log("database ready (Supabase Postgres)");
await closeDb();
