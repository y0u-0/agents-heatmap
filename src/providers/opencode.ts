import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import type { Provider, AgentData, TokenEntry } from "../types";
import { getUtcOffsetHours, buildAgentData } from "../types";

const DB_PATH = join(homedir(), ".local/share/opencode/opencode.db");

interface StepRow {
  model: string;
  day: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
}

function sqliteOffset(): string {
  const h = getUtcOffsetHours();
  return h >= 0 ? `+${h} hours` : `${h} hours`;
}

export const opencode: Provider = {
  name: "Open Code",
  load(): Promise<AgentData | null> {
    if (!existsSync(DB_PATH)) return Promise.resolve(null);

    const offset = sqliteOffset();

    const tokenQuery = `
WITH session_models AS (
  SELECT session_id, json_extract(data, '$.model.modelID') as model
  FROM message
  WHERE json_extract(data, '$.model.modelID') IS NOT NULL
  GROUP BY session_id
)
SELECT
  COALESCE(sm.model, 'unknown') as model,
  date(sp.time_created/1000, 'unixepoch', '${offset}') as day,
  COALESCE(SUM(json_extract(sp.data, '$.tokens.input')), 0) as input_tokens,
  COALESCE(SUM(json_extract(sp.data, '$.tokens.output')), 0) as output_tokens,
  COALESCE(SUM(json_extract(sp.data, '$.tokens.reasoning')), 0) as reasoning_tokens,
  COALESCE(SUM(json_extract(sp.data, '$.tokens.cache.read')), 0) as cache_read,
  COALESCE(SUM(json_extract(sp.data, '$.tokens.cache.write')), 0) as cache_write
FROM part sp
LEFT JOIN session_models sm ON sp.session_id = sm.session_id
WHERE json_extract(sp.data, '$.type') = 'step-finish'
GROUP BY sm.model, day
ORDER BY day DESC
`;

    const activityQuery = `
SELECT day FROM (
  SELECT date(time_created/1000, 'unixepoch', '${offset}') as day FROM message
  UNION
  SELECT date(time_created/1000, 'unixepoch', '${offset}') as day FROM session
  UNION
  SELECT date(time_created/1000, 'unixepoch', '${offset}') as day FROM part
)
GROUP BY day
`;

    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.query(tokenQuery).all() as StepRow[];
    const activityDays = db.query(activityQuery).all() as Array<{ day: string }>;
    db.close();

    if (rows.length === 0 && activityDays.length === 0) return Promise.resolve(null);

    const entries: TokenEntry[] = [];

    for (const { day } of activityDays) {
      entries.push({ date: day, model: "unknown", input: 0, output: 0 });
    }

    for (const row of rows) {
      entries.push({
        date: row.day,
        model: row.model,
        input: row.input_tokens + row.cache_read + row.cache_write,
        output: row.output_tokens + row.reasoning_tokens,
      });
    }

    return Promise.resolve(buildAgentData(this.name, entries));
  },
};
