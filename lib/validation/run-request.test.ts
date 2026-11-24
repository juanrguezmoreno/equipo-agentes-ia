import { describe, expect, it } from "vitest";
import {
  RUN_REQUEST_MAX_CHARS,
  normalizeRunRequest,
  validateRunRequest,
} from "./run-request";

function issueOf(raw: unknown) {
  const result = validateRunRequest(raw);
  return result.ok ? null : result.issue;
}

describe("validateRunRequest", () => {
  it("accepts a normal request and returns the normalised text", () => {
    const result = validateRunRequest(
      "  Crea un README.md\r\n\r\n\r\n\r\ncon una sección de instalación.  ",
    );
    expect(result).toEqual({
      ok: true,
      value: "Crea un README.md\n\ncon una sección de instalación.",
    });
  });

  it("rejects missing, empty and whitespace-only input", () => {
    expect(issueOf(undefined)).toBe("empty");
    expect(issueOf(42)).toBe("empty");
    expect(issueOf("   \n\t ")).toBe("empty");
  });

  it("enforces minimum and maximum length", () => {
    expect(issueOf("Haz algo")).toBe("too_short");
    expect(issueOf(`Crea una página ${"a".repeat(RUN_REQUEST_MAX_CHARS)}`)).toBe(
      "too_long",
    );
    const atLimit = `Crea una página de contacto ${"x".repeat(
      RUN_REQUEST_MAX_CHARS - 28,
    )}`;
    expect(atLimit).toHaveLength(RUN_REQUEST_MAX_CHARS);
    expect(issueOf(atLimit)).toBeNull();
  });

  it("rejects control characters but allows tabs and new lines", () => {
    expect(issueOf("Crea un README\u0000 con secciones")).toBe(
      "control_characters",
    );
    expect(issueOf("Crea un README\u001b[31m con secciones")).toBe(
      "control_characters",
    );
    expect(issueOf("Crea un README:\n\t- Resumen\n\t- Cambios")).toBeNull();
  });

  it("rejects input that is not a description", () => {
    expect(issueOf("1234567890 1234")).toBe("not_meaningful");
    expect(issueOf("aaaaaaaaaaaaaaaa")).toBe("not_meaningful");
    expect(issueOf("jajajajajaja jajaja")).toBe("not_meaningful");
    expect(issueOf("!!!!????....----")).toBe("not_meaningful");
  });

  it("accepts non-Latin scripts", () => {
    expect(issueOf("Создай страницу контактов с формой")).toBeNull();
  });

  it("rejects requests that contain credentials", () => {
    expect(
      issueOf(`Usa esta clave AIza${"x".repeat(35)} para llamar a la API`),
    ).toBe("contains_secret");
    expect(issueOf(`Configura el token gsk_${"a1".repeat(15)} en el proyecto`)).toBe(
      "contains_secret",
    );
    expect(
      issueOf("Guarda esto: -----BEGIN RSA PRIVATE KEY----- en un archivo"),
    ).toBe("contains_secret");
  });
});

describe("normalizeRunRequest", () => {
  it("is idempotent", () => {
    const once = normalizeRunRequest(" a \r\n\n\n\n b ");
    expect(normalizeRunRequest(once)).toBe(once);
  });
});
