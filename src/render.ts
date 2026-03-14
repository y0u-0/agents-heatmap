import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { AgentData, ModelTokens } from "./types";
import { toLocalDateStr } from "./types";

const SECTION_PAD = 50;
const BG = "#FFFFFF";
const TEXT_PRIMARY = "#1a1a1a";
const TEXT_SECONDARY = "#6b7280";
const TEXT_LABEL = "#9ca3af";
const LEFT_PAD = 60;
const RIGHT_PAD = 50;
const HEATMAP_LEFT = LEFT_PAD + 35;
const HEATMAP_GAP = 3;
const CELL_SIZE = 14;
const WEEKS_IN_YEAR = 54;
const WIDTH = HEATMAP_LEFT + WEEKS_IN_YEAR * (CELL_SIZE + HEATMAP_GAP) + RIGHT_PAD;

interface AgentTheme {
  shades: string[];
  empty: string;
}

const THEMES: Record<string, AgentTheme> = {
  "Claude Code": {
    shades: ["#fed7aa", "#fb923c", "#f97316", "#ea580c"],
    empty: "#f3f4f6",
  },
  Codex: {
    shades: ["#bfdbfe", "#60a5fa", "#3b82f6", "#2563eb"],
    empty: "#f3f4f6",
  },
  "Open Code": {
    shades: ["#e5e7eb", "#9ca3af", "#6b7280", "#4b5563"],
    empty: "#f3f4f6",
  },
  Cursor: {
    shades: ["#d1fae5", "#34d399", "#10b981", "#059669"],
    empty: "#f3f4f6",
  },
  "All Agents": {
    shades: ["#e9d5ff", "#a855f7", "#9333ea", "#7e22ce"],
    empty: "#f3f4f6",
  },
};

function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}


function getMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function computeStreaks(activeDates: Set<string>, today: string): { longest: number; current: number } {
  if (activeDates.size === 0) return { longest: 0, current: 0 };

  const sorted = [...activeDates].sort();
  let longest = 1;
  let streak = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T12:00:00");
    const curr = new Date(sorted[i] + "T12:00:00");
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);

    if (diffDays === 1) {
      streak++;
      if (streak > longest) longest = streak;
    } else {
      streak = 1;
    }
  }

  let current = 0;
  const d = new Date(today + "T12:00:00");
  while (true) {
    if (activeDates.has(toLocalDateStr(d))) {
      current++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return { longest, current };
}

function sectionHeight(): number {
  return 55 + 7 * (CELL_SIZE + HEATMAP_GAP) + 30 + 30 + 60 + 20;
}

const SCALE = 4;

export function renderImage(agents: AgentData[], today: string): Buffer {
  const secH = sectionHeight();
  const totalH = SECTION_PAD + agents.length * (secH + 30) + SECTION_PAD;

  const canvas = createCanvas(WIDTH * SCALE, totalH * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, totalH);

  let y = SECTION_PAD;
  for (const agent of agents) {
    renderSection(ctx, agent, y, today);
    y += secH + 30;
  }

  return Buffer.from(canvas.toBuffer("image/png"));
}

function renderSection(
  ctx: SKRSContext2D,
  agent: AgentData,
  startY: number,
  today: string
): void {
  const theme = THEMES[agent.source] ?? THEMES["Open Code"]!;
  const contentW = WIDTH - LEFT_PAD - RIGHT_PAD;
  let y = startY;

  ctx.font = "bold 24px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = TEXT_PRIMARY;
  ctx.textBaseline = "top";
  ctx.fillText(agent.source, LEFT_PAD, y + 8);

  const stats = [
    { label: "INPUT TOKENS", value: formatTokens(agent.totalInput) },
    { label: "OUTPUT TOKENS", value: formatTokens(agent.totalOutput) },
    { label: "TOTAL TOKENS", value: formatTokens(agent.totalTokens) },
  ];

  let sx = WIDTH - RIGHT_PAD;
  for (let i = stats.length - 1; i >= 0; i--) {
    ctx.font = "10px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = TEXT_LABEL;
    ctx.textAlign = "right";
    ctx.fillText(stats[i]!.label, sx, y);

    ctx.font = "bold 20px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.fillText(stats[i]!.value, sx, y + 16);
    sx -= 170;
  }
  ctx.textAlign = "left";
  y += 55;

  const tokensByDate = new Map(agent.byDay.map((d) => [d.date, d.total]));
  const activeDates = new Set(agent.byDay.filter((d) => d.total > 0).map((d) => d.date));

  const nonZeroTotals = agent.byDay.map((d) => d.total).filter((t) => t > 0).sort((a, b) => a - b);
  const q = (arr: number[], pct: number) => arr[Math.max(0, Math.ceil(arr.length * pct) - 1)];
  const thresholds = nonZeroTotals.length >= 4
    ? [1, q(nonZeroTotals, 0.25), q(nonZeroTotals, 0.50), q(nonZeroTotals, 0.75)]
    : [1, 1, 1, 1];

  const todayDate = new Date(today + "T12:00:00");
  const yearAgo = addDays(todayDate, -364);
  const startMonday = getMonday(yearAgo);

  const weeks: string[][] = [];
  let weekStart = new Date(startMonday);
  while (weekStart <= todayDate) {
    const week: string[] = [];
    for (let dow = 0; dow < 7; dow++) {
      week.push(toLocalDateStr(addDays(weekStart, dow)));
    }
    weeks.push(week);
    weekStart = addDays(weekStart, 7);
  }

  const yearAgoStr = toLocalDateStr(yearAgo);
  const todayStr = today;

  ctx.font = "10px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = TEXT_SECONDARY;
  ctx.textBaseline = "top";

  let lastMonth = -1;
  for (let w = 0; w < weeks.length; w++) {
    const d = new Date(weeks[w]![0]! + "T12:00:00");
    const month = d.getMonth();
    if (month !== lastMonth) {
      const monthName = d.toLocaleString("en-US", { month: "short" });
      ctx.fillText(monthName, HEATMAP_LEFT + w * (CELL_SIZE + HEATMAP_GAP), y);
      lastMonth = month;
    }
  }
  y += 18;

  const dayLabels = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
  for (let dow = 0; dow < 7; dow++) {
    if (dayLabels[dow]) {
      ctx.font = "10px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = TEXT_SECONDARY;
      ctx.fillText(dayLabels[dow]!, LEFT_PAD, y + dow * (CELL_SIZE + HEATMAP_GAP) + 2);
    }
  }

  for (let w = 0; w < weeks.length; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const ds = weeks[w]![dow]!;
      if (ds < yearAgoStr || ds > todayStr) continue;

      const tokens = tokensByDate.get(ds) ?? 0;
      const x = HEATMAP_LEFT + w * (CELL_SIZE + HEATMAP_GAP);
      const cy = y + dow * (CELL_SIZE + HEATMAP_GAP);

      if (tokens === 0) {
        ctx.fillStyle = theme.empty;
      } else if (tokens >= thresholds[3]!) {
        ctx.fillStyle = theme.shades[3]!;
      } else if (tokens >= thresholds[2]!) {
        ctx.fillStyle = theme.shades[2]!;
      } else if (tokens >= thresholds[1]!) {
        ctx.fillStyle = theme.shades[1]!;
      } else {
        ctx.fillStyle = theme.shades[0]!;
      }

      roundRect(ctx, x, cy, CELL_SIZE, CELL_SIZE, 2);
    }
  }

  y += 7 * (CELL_SIZE + HEATMAP_GAP) + 8;

  ctx.font = "10px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = TEXT_SECONDARY;
  ctx.fillText("LESS", HEATMAP_LEFT, y);

  const legendX = HEATMAP_LEFT + 35;
  ctx.fillStyle = theme.empty;
  roundRect(ctx, legendX, y - 1, 12, 12, 2);
  for (let i = 0; i < theme.shades.length; i++) {
    ctx.fillStyle = theme.shades[i]!;
    roundRect(ctx, legendX + (i + 1) * 15, y - 1, 12, 12, 2);
  }
  ctx.fillStyle = TEXT_SECONDARY;
  ctx.fillText("MORE", legendX + (theme.shades.length + 1) * 15 + 5, y);

  y += 35;

  const { longest, current: currentStreak } = computeStreaks(activeDates, today);
  const mostUsedModel = agent.byModel[0];

  const thirtyDaysAgo = toLocalDateStr(addDays(todayDate, -30));
  const recentDays = agent.byDay.filter((d) => d.date >= thirtyDaysAgo);
  const recentTokens = recentDays.reduce((s, d) => s + d.total, 0);


  const recentModelMap = new Map<string, ModelTokens>();
  for (const e of agent.entries) {
    if (e.date < thirtyDaysAgo) continue;
    const total = e.input + e.output;
    const m = recentModelMap.get(e.model) ?? { model: e.model, input: 0, output: 0, total: 0 };
    m.input += e.input;
    m.output += e.output;
    m.total += total;
    recentModelMap.set(e.model, m);
  }
  const recentTopModel = [...recentModelMap.values()].sort((a, b) => b.total - a.total)[0];

  const footerItems = [
    {
      label: "MOST USED MODEL",
      value: mostUsedModel ? truncate(mostUsedModel.model, 22) : "—",
      sub: mostUsedModel ? `(${formatTokens(mostUsedModel.total)})` : "",
    },
    {
      label: "LAST 30 DAYS",
      value: recentTopModel ? truncate(recentTopModel.model, 22) : "—",
      sub: recentTokens > 0 ? `(${formatTokens(recentTokens)})` : "",
    },
    {
      label: "LONGEST STREAK",
      value: `${longest} days`,
      sub: "",
    },
    {
      label: "CURRENT STREAK",
      value: `${currentStreak} days`,
      sub: "",
    },
  ];

  const colW = contentW / footerItems.length;
  for (let i = 0; i < footerItems.length; i++) {
    const item = footerItems[i]!;
    const fx = LEFT_PAD + i * colW;

    ctx.font = "9px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = TEXT_LABEL;
    ctx.fillText(item.label, fx, y);

    ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.fillText(item.value, fx, y + 15);

    if (item.sub) {
      const valueWidth = ctx.measureText(item.value).width;
      ctx.font = "12px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = TEXT_SECONDARY;
      ctx.fillText(` ${item.sub}`, fx + valueWidth, y + 15);
    }
  }
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}
