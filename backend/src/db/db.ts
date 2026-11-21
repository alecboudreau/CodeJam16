// better-sqlite3 helpers (owner: Person A).
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

export function initDb(): void {
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  db.exec(readFileSync(schemaPath, "utf8"));
}
