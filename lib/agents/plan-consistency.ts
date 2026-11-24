import type { Plan } from "./schemas";

export interface PathRepair {
  task: number;
  from: string;
  to: string;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Aligns the checks of each task that name the same file in different
 * folders. A real plan checked app/contacto/_components/ContactForm.tsx with
 * file_exists and exports_symbol, but app/_components/ContactForm.tsx with
 * contains_text: no delivery could ever pass, and the task failed after three
 * identical, correct iterations.
 *
 * The repair is deliberately narrow: only same-name files within one task,
 * aligned to the path the task declares in `files`, else the one a
 * file_exists check names, else the most used one. Everything else is left
 * to schema validation and Testing.
 */
export function alignCheckPaths(plan: Plan): { plan: Plan; repairs: PathRepair[] } {
  const repairs: PathRepair[] = [];
  const tasks = plan.tasks.map((task, index) => {
    const byName = new Map<string, string[]>();
    for (const check of task.checks) {
      const name = basename(check.path);
      byName.set(name, [...(byName.get(name) ?? []), check.path]);
    }

    const target = new Map<string, string>();
    for (const [name, paths] of byName) {
      if (new Set(paths).size < 2) continue;
      const declared =
        task.files.find((file) => basename(file) === name) ??
        task.checks.find(
          (check) => check.type === "file_exists" && basename(check.path) === name,
        )?.path;
      const counts = new Map<string, number>();
      for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
      const mostUsed = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      const canonical = declared ?? mostUsed;
      for (const path of new Set(paths)) {
        if (path !== canonical) {
          target.set(path, canonical);
          repairs.push({ task: index + 1, from: path, to: canonical });
        }
      }
    }

    if (target.size === 0) return task;
    return {
      ...task,
      checks: task.checks.map((check) =>
        target.has(check.path) ? { ...check, path: target.get(check.path)! } : check,
      ),
    };
  });
  return { plan: { ...plan, tasks }, repairs };
}
