import { readdir } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import type { Provider, AgentData, TokenEntry } from "../types";
import { toLocalDateStr, buildAgentData } from "../types";

const CODEX_DIR = process.env.CODEX_HOME || join(homedir(), ".codex");
const SESSIONS_DIRS = [
  join(CODEX_DIR, "sessions"),
  join(CODEX_DIR, "archived_sessions"),
];

function readDefaultModel(): string {
  const configPath = join(CODEX_DIR, "config.toml");
  if (!existsSync(configPath)) return "gpt-5.3-codex";
  try {
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/^model\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? "gpt-5.3-codex";
  } catch {
    return "gpt-5.3-codex";
  }
}

async function findJsonlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(d: string) {
    if (!existsSync(d)) return;
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }

  await walk(dir);
  return files;
}

function parseSession(content: string): TokenEntry | null {
  const lines = content.split("\n").filter((l) => l.trim());

  let date = "";
  let model = "";
  let lastTokenCount: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
    total_tokens: number;
  } | null = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const ts = event.timestamp;

      if (event.type === "turn_context" && event.payload?.model) {
        model = event.payload.model;
      }

      if (event.type === "session_meta") {
        const metaTs = ts ?? event.payload?.timestamp ?? "";
        if (metaTs) {
          date = toLocalDateStr(new Date(metaTs));
        }
      }

      if (
        event.type === "event_msg" &&
        event.payload?.type === "token_count" &&
        event.payload?.info?.total_token_usage
      ) {
        lastTokenCount = event.payload.info.total_token_usage;
      }
    } catch {
      continue;
    }
  }

  if (!model) model = readDefaultModel();
  if (!date || !lastTokenCount) return null;

  return {
    date,
    model,
    input: lastTokenCount.input_tokens ?? 0,
    output: (lastTokenCount.output_tokens ?? 0) + (lastTokenCount.reasoning_output_tokens ?? 0),
  };
}

export const codex: Provider = {
  name: "Codex",
  async load(): Promise<AgentData | null> {
    const files: string[] = [];
    for (const dir of SESSIONS_DIRS) {
      if (existsSync(dir)) {
        files.push(...(await findJsonlFiles(dir)));
      }
    }
    if (files.length === 0) return null;

    const entries: TokenEntry[] = [];
    for (const file of files) {
      const content = await Bun.file(file).text();
      const entry = parseSession(content);
      if (entry) entries.push(entry);
    }

    return buildAgentData(this.name, entries);
  },
};
