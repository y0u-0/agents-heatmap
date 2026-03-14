export const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function getUtcOffsetHours(): number {
  return -(new Date().getTimezoneOffset() / 60);
}

export function toLocalDateStr(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

export interface DayTokens {
  date: string;
  input: number;
  output: number;
  total: number;
}

export interface ModelTokens {
  model: string;
  input: number;
  output: number;
  total: number;
}

export interface AgentData {
  source: string;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  byDay: DayTokens[];
  byModel: ModelTokens[];
  entries: TokenEntry[];
  dateRange: { from: string; to: string };
}

export interface TokenEntry {
  date: string;
  model: string;
  input: number;
  output: number;
}

export interface Provider {
  name: string;
  load(): Promise<AgentData | null>;
}

export function buildAgentData(source: string, entries: TokenEntry[]): AgentData | null {
  if (entries.length === 0) return null;

  const dayMap = new Map<string, DayTokens>();
  const modelMap = new Map<string, ModelTokens>();

  for (const e of entries) {
    const total = e.input + e.output;

    const day = dayMap.get(e.date) ?? { date: e.date, input: 0, output: 0, total: 0 };
    day.input += e.input;
    day.output += e.output;
    day.total += total;
    dayMap.set(e.date, day);

    const m = modelMap.get(e.model) ?? { model: e.model, input: 0, output: 0, total: 0 };
    m.input += e.input;
    m.output += e.output;
    m.total += total;
    modelMap.set(e.model, m);
  }

  const byDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const byModel = [...modelMap.values()].sort((a, b) => b.total - a.total);

  return {
    source,
    totalInput: byDay.reduce((s, d) => s + d.input, 0),
    totalOutput: byDay.reduce((s, d) => s + d.output, 0),
    totalTokens: byDay.reduce((s, d) => s + d.total, 0),
    byDay,
    byModel,
    entries,
    dateRange: { from: byDay[0]?.date ?? "", to: byDay[byDay.length - 1]?.date ?? "" },
  };
}
