import type { ErrorAction, UserFacingError } from "@/lib/errors/user-messages";

export type NoticeTone = "danger" | "neutral";

const actionLabels: Partial<Record<ErrorAction, string>> = {
  retry_run: "Volver a lanzar la petición",
  resume: "Reanudar ejecución",
  reload: "Recargar la página",
  edit: "Editar la petición",
};

/**
 * Explains a problem in two lines (what happened, what to do) and offers the
 * one action that helps. Danger notices are announced immediately; neutral
 * ones politely, so a retry countdown does not interrupt screen readers.
 */
export default function Notice({
  notice,
  tone,
  onAction,
  onDismiss,
}: {
  notice: UserFacingError;
  tone: NoticeTone;
  onAction?: (action: ErrorAction) => void;
  onDismiss?: () => void;
}) {
  const actionLabel = notice.action ? actionLabels[notice.action] : undefined;
  return (
    <div
      className="notice"
      data-tone={tone}
      data-code={notice.code}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div className="notice-copy">
        <p className="notice-title">{notice.title}</p>
        <p className="notice-detail">{notice.detail}</p>
      </div>
      {(actionLabel && onAction) || onDismiss ? (
        <div className="notice-actions">
          {actionLabel && onAction && notice.action && (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => onAction(notice.action!)}
            >
              {actionLabel}
            </button>
          )}
          {onDismiss && (
            <button
              className="button button-ghost"
              type="button"
              onClick={onDismiss}
              aria-label={`Cerrar aviso: ${notice.title}`}
            >
              Cerrar
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
