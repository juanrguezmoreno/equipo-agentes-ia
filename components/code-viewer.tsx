"use client";

import { useMemo, useState } from "react";
import type { Tables } from "@/types/database";

type Artifact = Tables<"artifacts">;
type Task = Tables<"agent_tasks">;

function artifactKey(artifact: Artifact): string {
  return `${artifact.path}@${artifact.revision}`;
}

export default function CodeViewer({
  artifacts,
  tasks,
}: {
  artifacts: Artifact[];
  tasks: Task[];
}) {
  const sortedArtifacts = useMemo(
    () =>
      [...artifacts].sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          right.revision - left.revision ||
          left.created_at.localeCompare(right.created_at),
      ),
    [artifacts],
  );
  const latestByPath = useMemo(() => {
    const latest = new Map<string, number>();
    for (const artifact of sortedArtifacts) {
      latest.set(
        artifact.path,
        Math.max(latest.get(artifact.path) ?? 0, artifact.revision),
      );
    }
    return latest;
  }, [sortedArtifacts]);
  const [selectedKey, setSelectedKey] = useState("");

  const latestArtifact = sortedArtifacts.reduce<Artifact | null>(
    (latest, artifact) =>
      !latest ||
      artifact.created_at.localeCompare(latest.created_at) > 0 ||
      (artifact.created_at === latest.created_at &&
        artifact.revision > latest.revision)
        ? artifact
        : latest,
    null,
  );
  const selectedArtifact =
    sortedArtifacts.find((artifact) => artifactKey(artifact) === selectedKey) ??
    latestArtifact;

  return (
    <section className="surface-panel" aria-labelledby="code-heading">
      <div className="panel-heading">
        <div>
          <h2 id="code-heading">Proyecto virtual</h2>
          <p className="section-subtitle">
            Archivos versionados que produce Develop
          </p>
        </div>
        {sortedArtifacts.length > 0 && (
          <div className="artifact-toolbar">
            <label className="sr-only" htmlFor="artifact-version">
              Archivo y revisión
            </label>
            <select
              className="artifact-select"
              id="artifact-version"
              value={selectedArtifact ? artifactKey(selectedArtifact) : ""}
              onChange={(event) => setSelectedKey(event.currentTarget.value)}
            >
              {sortedArtifacts.map((artifact) => {
                const task = tasks.find((candidate) => candidate.id === artifact.task_id);
                const isLatest = latestByPath.get(artifact.path) === artifact.revision;
                return (
                  <option key={artifactKey(artifact)} value={artifactKey(artifact)}>
                    {artifact.path} · r{artifact.revision}
                    {isLatest ? " · actual" : ""}
                    {task ? ` · ${task.title}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>
      {selectedArtifact ? (
        <div className="code-frame">
          <div className="code-frame-top">
            <span className="code-file-name">{selectedArtifact.path}</span>
            <span className="code-revision">
              r{selectedArtifact.revision}
              {latestByPath.get(selectedArtifact.path) ===
                selectedArtifact.revision && " · actual"}
            </span>
          </div>
          <div
            className="code-scroll"
            role="region"
            aria-label={`Contenido de ${selectedArtifact.path}`}
            tabIndex={0}
          >
            <pre>
              <code>{selectedArtifact.content}</code>
            </pre>
          </div>
        </div>
      ) : (
        <div className="code-empty">
          Aún no hay archivos. El código aparecerá aquí cuando Develop complete
          una tarea.
        </div>
      )}
    </section>
  );
}
