import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Provider, AgentData, TokenEntry } from "../types";
import { toLocalDateStr, buildAgentData } from "../types";

const CURSOR_STATE_PATHS = [
  process.env.CURSOR_STATE_DB_PATH,
  join(homedir(), "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Cursor/User/globalStorage/state.vscdb"),
  join(process.env.APPDATA ?? "", "Cursor/User/globalStorage/state.vscdb"),
].filter(Boolean) as string[];

function findStateDb(): string | null {
  for (const p of CURSOR_STATE_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function extractToken(): { token: string; sub: string } | null {
  const dbPath = findStateDb();
  if (!dbPath) return null;

  let row: { value: string } | null = null;
  try {
    const db = new Database(dbPath, { readonly: true });
    row = db.query("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1").get() as { value: string } | null;
    db.close();
  } catch {
    try {
      const result = Bun.spawnSync(["sqlite3", dbPath, "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1"]);
      const value = result.stdout.toString().trim();
      if (value) row = { value };
    } catch {
      return null;
    }
  }

  if (!row?.value) return null;

  try {
    const jwtParts = row.value.split(".");
    const encoded = jwtParts[1];
    if (!encoded) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64").toString());
    return { token: row.value, sub: payload.sub };
  } catch {
    return null;
  }
}

async function fetchCsv(token: string, sub: string): Promise<string | null> {
  const url = "https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens";

  const attempts = [
    { Cookie: `WorkosCursorSessionToken=${sub}::${token}` },
    { Cookie: `WorkosCursorSessionToken=${encodeURIComponent(sub + "::" + token)}` },
    { Cookie: `WorkosCursorSessionToken=${token}` },
    { Authorization: `Bearer ${token}`, Cookie: `WorkosCursorSessionToken=${sub}::${token}` },
  ];

  for (const extra of attempts) {
    const res = await fetch(url, {
      headers: { Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8", ...extra } as Record<string, string>,
    });
    if (!res.ok) continue;
    const body = await res.text();
    if (body.includes("Date,") && body.includes("Output Tokens")) return body;
  }

  return null;
}

interface CsvColumns {
  date: number;
  model: number;
  inputWithCache: number;
  inputWithoutCache: number;
  cacheRead: number;
  outputTokens: number;
}

function detectColumns(header: string): CsvColumns | null {
  const cols = parseCSVLine(header).map((c) => c.replace(/"/g, "").trim());
  const idx = (name: string) => cols.indexOf(name);

  const date = Math.max(idx("Date"), idx("Timestamp"));
  const model = idx("Model");
  const inputWithCache = idx("Input (w/ Cache Write)");
  const inputWithoutCache = idx("Input (w/o Cache Write)");
  const cacheRead = idx("Cache Read");
  const outputTokens = idx("Output Tokens");

  if ([date, model, inputWithCache, inputWithoutCache, cacheRead, outputTokens].includes(-1)) return null;

  return { date, model, inputWithCache, inputWithoutCache, cacheRead, outputTokens };
}

function parseCsvContent(content: string): TokenEntry[] {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0];
  if (!header) return [];
  const columns = detectColumns(header);
  if (!columns) return [];

  const entries: TokenEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const fields = parseCSVLine(line);
    const clean = (idx: number) => Number(fields[idx]?.replace(/"/g, "")) || 0;

    const dateStr = fields[columns.date]?.replace(/"/g, "");
    if (!dateStr) continue;

    entries.push({
      date: toLocalDateStr(new Date(dateStr)),
      model: fields[columns.model]?.replace(/"/g, "") ?? "unknown",
      input: clean(columns.inputWithCache) + clean(columns.inputWithoutCache) + clean(columns.cacheRead),
      output: clean(columns.outputTokens),
    });
  }

  return entries;
}

export function createCursorProvider(csvPath?: string): Provider {
  return {
    name: "Cursor",
    async load(): Promise<AgentData | null> {
      let csv: string | null = null;

      if (csvPath && existsSync(csvPath)) {
        csv = await Bun.file(csvPath).text();
      } else {
        const auth = extractToken();
        if (!auth) return null;
        csv = await fetchCsv(auth.token, auth.sub);
      }

      if (!csv) return null;
      return buildAgentData(this.name, parseCsvContent(csv));
    },
  };
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
