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
  loading,
}: {
  artifacts: Artifact[];
  tasks: Task[];
  loading: boolean;
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

  const isSelectedLatest =
    selectedArtifact !== null &&
    latestByPath.get(selectedArtifact.path) === selectedArtifact.revision;

  return (
    <section className="panel code-panel" aria-labelledby="code-heading">
      <div className="panel-head">
        <h2 id="code-heading" className="panel-title">
          Proyecto virtual
        </h2>
        {sortedArtifacts.length > 0 && (
          <>
            <label className="sr-only" htmlFor="artifact-version">
              Archivo y revisión
            </label>
            <select
              className="select"
              id="artifact-version"
              value={selectedArtifact ? artifactKey(selectedArtifact) : ""}
              onChange={(event) => setSelectedKey(event.currentTarget.value)}
            >
              {sortedArtifacts.map((artifact) => {
                const task = tasks.find((candidate) => candidate.id === artifact.task_id);
                const isLatest = latestByPath.get(artifact.path) === artifact.revision;
                return (
                  <option key={artifactKey(artifact)} value={artifactKey(artifact)}>
                    {`${artifact.path}, revisión ${artifact.revision}${isLatest ? " (actual)" : ""}${task ? `, T${task.sequence}` : ""}`}
                  </option>
                );
              })}
            </select>
          </>
        )}
      </div>
      {loading ? (
        <div className="skeleton skeleton-code" aria-hidden="true" />
      ) : selectedArtifact ? (
        <div className="code-frame">
          <div className="code-frame-top">
            <span className="code-file-name">{selectedArtifact.path}</span>
            <span className="code-revision" data-latest={isSelectedLatest}>
              {isSelectedLatest
                ? `Revisión ${selectedArtifact.revision}, la actual`
                : `Revisión ${selectedArtifact.revision}`}
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
        <p className="empty-state">
          Develop todavía no ha escrito archivos. Cada versión que guarde se
          podrá abrir aquí, también las anteriores.
        </p>
      )}
    </section>
  );
}
