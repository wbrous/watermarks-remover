// remove-watermarks: /remove-watermarks omp extension.
//
// Wraps the existing watermarks-remover CLIs (audit_dir.py / clean_file.py)
// — no detection or removal logic is duplicated here — then hands the
// results to the agent as a follow-up message so it actually verifies the
// outcome (reviews diffs, re-checks residual findings, flags anything odd)
// instead of the extension silently trusting its own subprocess output.
//
// Locates the watermarks-remover checkout the same way the global git hook
// does: WATERMARKS_REMOVER_HOME env var, else
// ~/.config/watermarks-remover/global-hooks.conf (written by
// service/scripts/install_global_hooks.sh).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

interface AuditItem {
  path: string;
  kind: string;
  has_c2pa?: boolean;
  has_ai_metadata?: boolean;
  findings?: string[];
  confidence?: string[];
  notes?: string[];
}

interface AuditReport {
  root: string;
  files_scanned: number;
  files_skipped: Array<{ path: string; reason: string }>;
  summary: {
    total: number;
    actionable_files: number;
  };
  files: AuditItem[];
}

interface CleanResult {
  path: string;
  status: "changed" | "unchanged" | "failed";
  detail: string;
}

function isActionable(item: AuditItem): boolean {
  if (item.has_c2pa) return true;
  return (item.confidence ?? []).some((c) => c === "confirmed" || c === "probable");
}

function resolveWatermarksHome(): string | undefined {
  const envHome = process.env.WATERMARKS_REMOVER_HOME;
  if (envHome && existsSync(join(envHome, "service/scripts/audit_dir.py"))) {
    return envHome;
  }
  const configPath =
    process.env.WATERMARKS_REMOVER_GLOBAL_CONFIG ??
    join(homedir(), ".config/watermarks-remover/global-hooks.conf");
  if (!existsSync(configPath)) return undefined;
  const match = readFileSync(configPath, "utf8").match(/WATERMARKS_REMOVER_HOME="?([^"\n]+)"?/);
  const home = match?.[1]?.trim();
  if (home && existsSync(join(home, "service/scripts/audit_dir.py"))) return home;
  return undefined;
}

function pythonBin(): string {
  return process.env.WATERMARKS_REMOVER_PYTHON || "python3";
}

function runAudit(scriptsDir: string, target: string, stylometry: boolean): AuditReport {
  const args = [join(scriptsDir, "audit_dir.py"), target, "--json"];
  if (stylometry) args.push("--check-stylometry");
  const out = execFileSync(pythonBin(), args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out) as AuditReport;
}

function runClean(scriptsDir: string, filePath: string): CleanResult {
  try {
    const out = execFileSync(pythonBin(), [join(scriptsDir, "clean_file.py"), filePath, "--in-place", "--json"], {
      encoding: "utf8",
    });
    const report = JSON.parse(out) as { actions?: unknown[] };
    const changed = Array.isArray(report.actions) && report.actions.length > 0;
    return { path: filePath, status: changed ? "changed" : "unchanged", detail: "" };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return { path: filePath, status: "failed", detail: (e.stderr || e.message || String(err)).trim() };
  }
}

function parseArgs(raw: string): { target: string; checkOnly: boolean; stylometry: boolean } {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let target = "";
  let checkOnly = false;
  let stylometry = false;
  for (const tok of tokens) {
    if (tok === "--check-only" || tok === "--dry-run" || tok === "--detect-only") checkOnly = true;
    else if (tok === "--stylometry") stylometry = true;
    else if (!target) target = tok;
  }
  return { target: target || ".", checkOnly, stylometry };
}

export default function removeWatermarksExtension(pi: ExtensionAPI) {
  pi.registerCommand("remove-watermarks", {
    description: "Scan (and by default clean) a directory for AI/C2PA provenance marks, then ask the agent to verify",
    handler: async (args, ctx) => {
      const { target, checkOnly, stylometry } = parseArgs(args);
      const targetDir = isAbsolute(target) ? target : resolve(ctx.cwd, target);

      const home = resolveWatermarksHome();
      if (!home) {
        ctx.ui.notify(
          "watermarks-remover: no checkout found. Set WATERMARKS_REMOVER_HOME, or run " +
            "service/scripts/install_global_hooks.sh from a watermarks-remover checkout (it also writes the " +
            "config this command reads).",
          "error"
        );
        return;
      }
      const scriptsDir = join(home, "service/scripts");

      if (!existsSync(targetDir)) {
        ctx.ui.notify(`watermarks-remover: target directory does not exist: ${targetDir}`, "error");
        return;
      }

      ctx.ui.notify(`watermarks-remover: scanning ${targetDir} ...`, "info");
      let before: AuditReport;
      try {
        before = runAudit(scriptsDir, targetDir, stylometry);
      } catch (err) {
        const e = err as { stderr?: string; message?: string };
        ctx.ui.notify(`watermarks-remover: audit_dir.py failed: ${(e.stderr || e.message || err) as string}`, "error");
        return;
      }

      const actionable = before.files.filter(isActionable);
      if (actionable.length === 0) {
        ctx.ui.notify(
          `watermarks-remover: clean — ${before.files_scanned} file(s) scanned in ${targetDir}, no AI/C2PA marks found.`,
          "info"
        );
        return;
      }

      if (checkOnly) {
        const lines = actionable.map((item) => {
          const marks = [
            ...(item.has_c2pa ? ["C2PA manifest"] : []),
            ...(item.has_ai_metadata ? ["AI-generator metadata"] : []),
            ...(item.findings ?? []),
          ];
          return `- ${item.path}\n  ${marks.join("\n  ")}`;
        });
        pi.sendMessage(
          {
            customType: "watermarks-remover-report",
            content:
              `watermarks-remover found ${actionable.length}/${before.files_scanned} file(s) under ${targetDir} ` +
              `carrying AI/C2PA provenance marks (detect-only run, nothing was changed):\n\n${lines.join("\n")}\n\n` +
              "Verify these findings against the actual files, then decide whether to clean them " +
              "(e.g. `python3 " +
              `${join(scriptsDir, "clean_file.py")}` +
              " <path> --in-place`, or re-run `/remove-watermarks` without --check-only) and explain any file you " +
              "think is a false positive.",
            display: true,
            attribution: "user",
          },
          { triggerTurn: true }
        );
        return;
      }

      ctx.ui.notify(`watermarks-remover: cleaning ${actionable.length} file(s) ...`, "info");
      const results = actionable.map((item) => runClean(scriptsDir, item.path));
      const changed = results.filter((r) => r.status === "changed");
      const failed = results.filter((r) => r.status === "failed");

      let after: AuditReport | undefined;
      try {
        after = runAudit(scriptsDir, targetDir, stylometry);
      } catch {
        after = undefined;
      }
      const residual = after ? after.files.filter(isActionable) : undefined;

      const summaryLines = [
        `watermarks-remover cleaned ${changed.length}/${actionable.length} flagged file(s) under ${targetDir}:`,
        ...changed.map((r) => `  - ${r.path} (backup written as ${r.path}.bak)`),
        ...(failed.length
          ? [`Failed to clean ${failed.length} file(s):`, ...failed.map((r) => `  - ${r.path}: ${r.detail}`)]
          : []),
        residual
          ? residual.length
            ? `Residual actionable files after cleaning (${residual.length}): ${residual.map((r) => r.path).join(", ")}`
            : "Re-scan after cleaning found no remaining actionable files."
          : "Could not re-scan after cleaning to confirm residual findings.",
      ];

      pi.sendMessage(
        {
          customType: "watermarks-remover-report",
          content:
            `${summaryLines.join("\n")}\n\n` +
            "Verify this cleaning pass: diff each changed file against its `.bak` backup to confirm the intended " +
            "content/formatting survived, confirm the residual-findings count above is actually zero (or explain " +
            "why not), and flag anything that looks like collateral damage before this is committed. Delete the " +
            "`.bak` files once you've confirmed the diffs are fine.",
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });
}
