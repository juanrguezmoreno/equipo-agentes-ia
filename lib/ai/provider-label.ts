export type ProviderId = "google" | "groq" | "mock";

export function isProviderId(value: unknown): value is ProviderId {
  return value === "google" || value === "groq" || value === "mock";
}

export function providerLabel(provider: ProviderId): string {
  switch (provider) {
    case "google":
      return "Gemini";
    case "groq":
      return "Groq";
    case "mock":
      return "Simulado";
  }
}
