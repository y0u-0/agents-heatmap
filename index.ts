#!/usr/bin/env bun
import { claude, codex, opencode, createCursorProvider } from "./src/providers";
import { renderImage } from "./src/render";
import { toLocalDateStr, buildAgentData } from "./src/types";
import type { AgentData, Provider } from "./src/types";
import { writeFileSync } from "fs";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const cursorCsvPath = positional[0] || undefined;
const mode = flags.has("--combined") ? "combined"
  : flags.has("--separate") ? "separate"
  : "all";

const today = toLocalDateStr(new Date());

const allProviders: Record<string, Provider> = {
  claude,
  codex,
  cursor: createCursorProvider(cursorCsvPath),
  opencode,
};

const providerFlags = Object.keys(allProviders).filter((k) => flags.has(`--${k}`));
const selected = providerFlags.length > 0
  ? providerFlags.map((k) => allProviders[k]!)
  : Object.values(allProviders);

const providers: Provider[] = selected;
const agents = (await Promise.all(providers.map((p) => p.load()))).filter(
  (a): a is AgentData => a !== null
);

if (agents.length === 0) {
  console.log("No agent data found.");
  process.exit(0);
}

function combineAgents(sources: AgentData[]): AgentData {
  const dayEntries = sources.flatMap((s) =>
    s.byDay.map((d) => ({ date: d.date, model: "_all_", input: d.input, output: d.output }))
  );

  const base = buildAgentData("All Agents", dayEntries)!;

  const modelMap = new Map<string, { model: string; input: number; output: number; total: number }>();
  for (const s of sources) {
    for (const m of s.byModel) {
      const existing = modelMap.get(m.model) ?? { model: m.model, input: 0, output: 0, total: 0 };
      existing.input += m.input;
      existing.output += m.output;
      existing.total += m.total;
      modelMap.set(m.model, existing);
    }
  }
  base.byModel = [...modelMap.values()].sort((a, b) => b.total - a.total);

  return base;
}

if (mode === "combined" || mode === "all") {
  const combined = combineAgents(agents);
  const png = renderImage([combined], today);
  const outPath = "agents-heatmap-combined.png";
  writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${agents.length} sources merged, ${(png.length / 1024).toFixed(0)}KB)`);
}

if (mode === "separate" || mode === "all") {
  const png = renderImage(agents, today);
  const outPath = "agents-heatmap.png";
  writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${agents.length} agents, ${(png.length / 1024).toFixed(0)}KB)`);
}
