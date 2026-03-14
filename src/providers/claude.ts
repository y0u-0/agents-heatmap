import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { readdirSync, existsSync } from "fs";
import type { Provider, AgentData, TokenEntry } from "../types";
import { toLocalDateStr, buildAgentData } from "../types";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const ALT_CLAUDE_DIR = join(homedir(), ".config", "claude");
const PROJECTS_DIRS = [
  join(CLAUDE_DIR, "projects"),
  ...(CLAUDE_DIR !== join(homedir(), ".config", "claude")
    ? [join(ALT_CLAUDE_DIR, "projects")]
    : []),
];

function shortenModel(id: string): string {
  return id.replace("claude-", "").replace(/-\d{8}$/, "");
}

function collectJsonlFiles(): string[] {
  const files: string[] = [];

  for (const projectsDir of PROJECTS_DIRS) {
    if (!existsSync(projectsDir)) continue;

    for (const dir of readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const dirPath = join(projectsDir, dir.name);
      for (const file of readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"))) {
        files.push(join(dirPath, file));
      }

      const subagentsDir = join(dirPath, "subagents");
      if (existsSync(subagentsDir)) {
        for (const file of readdirSync(subagentsDir).filter((f) => f.endsWith(".jsonl"))) {
          files.push(join(subagentsDir, file));
        }
      }
    }
  }

  return files;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

interface CostCacheData {
  days: Record<string, Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>>;
}

interface StatsCacheData {
  dailyActivity?: Array<{ date: string; messageCount: number }>;
  dailyModelTokens?: Array<{ date: string; tokensByModel: Record<string, number> }>;
}

function entriesFromCostCache(costCache: CostCacheData): TokenEntry[] {
  const entries: TokenEntry[] = [];
  for (const [date, models] of Object.entries(costCache.days)) {
    for (const [modelId, tokens] of Object.entries(models)) {
      entries.push({
        date,
        model: shortenModel(modelId),
        input: tokens.input + tokens.cacheRead + tokens.cacheWrite,
        output: tokens.output,
      });
    }
  }
  return entries;
}

function entriesFromStatsCache(statsCache: StatsCacheData, coveredDates: Set<string>): TokenEntry[] {
  const entries: TokenEntry[] = [];

  if (statsCache.dailyActivity) {
    for (const a of statsCache.dailyActivity) {
      if (a.messageCount > 0 && !coveredDates.has(a.date)) {
        entries.push({ date: a.date, model: "unknown", input: 0, output: 0 });
      }
    }
  }

  if (statsCache.dailyModelTokens) {
    const zeroDates = new Set(entries.map((e) => e.date));
    for (const dmt of statsCache.dailyModelTokens) {
      if (!dmt.tokensByModel) continue;
      if (!zeroDates.has(dmt.date)) continue;
      for (const [modelId, outputTokens] of Object.entries(dmt.tokensByModel)) {
        if (outputTokens <= 0) continue;
        entries.push({
          date: dmt.date,
          model: shortenModel(modelId),
          input: 0,
          output: outputTokens,
        });
      }
    }
  }

  return entries;
}

async function entriesFromJsonl(files: string[], cachedDates: Set<string>): Promise<TokenEntry[]> {
  const entries: TokenEntry[] = [];

  for (const filePath of files) {
    const content = await Bun.file(filePath).text();
    const seenMessages = new Map<string, { date: string; model: string; input: number; output: number }>();

    for (const line of content.split("\n")) {
      if (!line) continue;
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(line); } catch { continue; }

      if (parsed.type !== "assistant") continue;
      const timestamp = parsed.timestamp as string | undefined;
      if (!timestamp) continue;

      const message = parsed.message as Record<string, unknown> | undefined;
      if (!message) continue;
      const usage = message.usage as Record<string, number> | undefined;
      if (!usage) continue;

      const date = toLocalDateStr(new Date(timestamp));
      if (cachedDates.has(date)) continue;

      const msgId = message.id as string | undefined;
      const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      const output = usage.output_tokens ?? 0;
      const model = (message.model as string) ?? "unknown";

      if (msgId) {
        const existing = seenMessages.get(msgId);
        if (existing) {
          existing.output = Math.max(existing.output, output);
          continue;
        }
        seenMessages.set(msgId, { date, model, input, output });
      } else {
        seenMessages.set(`_anon_${seenMessages.size}`, { date, model, input, output });
      }
    }

    for (const { date, model, input, output } of seenMessages.values()) {
      entries.push({ date, model: shortenModel(model), input, output });
    }
  }

  return entries;
}

export const claude: Provider = {
  name: "Claude Code",
  async load(): Promise<AgentData | null> {
    const entries: TokenEntry[] = [];

    const costCache = (await readJson(join(CLAUDE_DIR, "readout-cost-cache.json"))) as CostCacheData | null;
    if (costCache?.days) {
      entries.push(...entriesFromCostCache(costCache));
    }

    const cachedDates = new Set(costCache?.days ? Object.keys(costCache.days) : []);

    const statsCache = (await readJson(join(CLAUDE_DIR, "stats-cache.json"))) as StatsCacheData | null;
    if (statsCache) {
      entries.push(...entriesFromStatsCache(statsCache, cachedDates));
    }

    const jsonlEntries = await entriesFromJsonl(collectJsonlFiles(), cachedDates);
    entries.push(...jsonlEntries);

    return buildAgentData(this.name, entries);
  },
};
