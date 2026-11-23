import type { Tables } from "@/types/database";

export type EventAgent = Tables<"agent_events">["agent"];
export type StationId = "orchestrator" | "develop" | "testing" | "done";

interface Identity {
  name: string;
  role: string;
}

export const identities: Record<EventAgent | "done", Identity> = {
  orchestrator: { name: "Orquestador", role: "Divide la petición en tareas" },
  develop: { name: "Develop", role: "Escribe los archivos" },
  testing: { name: "Testing", role: "Comprueba y aprueba" },
  done: { name: "Hecha", role: "Tareas aprobadas" },
  system: { name: "Sistema", role: "Estado de la ejecución" },
};

/** Line icons drawn on a 20px grid; colour comes from `currentColor`. */
export function AgentIcon({
  agent,
  size = 18,
}: {
  agent: EventAgent | "done";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };

  switch (agent) {
    case "orchestrator":
      // One source splitting into three branches: a plan becoming tasks.
      return (
        <svg {...common}>
          <circle cx="4.5" cy="10" r="2" />
          <path d="M6.5 10h3M9.5 10c2 0 2-5.5 5-5.5M9.5 10h5M9.5 10c2 0 2 5.5 5 5.5" />
        </svg>
      );
    case "develop":
      return (
        <svg {...common}>
          <path d="M7 5.5 2.8 10 7 14.5M13 5.5l4.2 4.5-4.2 4.5M11.2 3.8 8.8 16.2" />
        </svg>
      );
    case "testing":
      return (
        <svg {...common}>
          <path d="M10 2.6 15.8 4.8v4.6c0 3.7-2.5 6.3-5.8 8-3.3-1.7-5.8-4.3-5.8-8V4.8L10 2.6Z" />
          <path d="m7.3 10.1 1.9 1.9 3.6-3.8" />
        </svg>
      );
    case "done":
      // Terminus flag.
      return (
        <svg {...common}>
          <path d="M5 17.5V3M5 3.6h9.2l-2 3.3 2 3.3H5" />
        </svg>
      );
    case "system":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="2.4" />
        </svg>
      );
  }
}
