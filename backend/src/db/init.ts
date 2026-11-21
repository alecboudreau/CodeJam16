// `npm run db:init`: creates the SQLite file from schema.sql.
import { config } from "../config";
import { initDb } from "./db";

initDb();
console.log(`database ready at ${config.databasePath}`);
