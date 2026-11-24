import { describe, expect, it } from "vitest";
import { runConventionChecks } from "./conventions";
import { runDeterministicChecks } from "./virtual-project";

const failed = (results: ReturnType<typeof runConventionChecks>) =>
  results.filter((result) => !result.passed).map((result) => result.name);

// Regression: the real run on 2026-11-24 approved this file.
const PAGES_ROUTER_CONTACT = `import { useState } from "react";

export default function Contact() {
  const [email, setEmail] = useState("");
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <input name="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Enviar</button>
    </form>
  );
}
`;

const APP_ROUTER_PAGE = `import ContactForm from "../_components/contact-form";

export const metadata = { title: "Contacto" };

export default function ContactPage() {
  return (
    <main>
      <h1>Contacto</h1>
      <ContactForm />
    </main>
  );
}
`;

const ACCESSIBLE_FORM = `"use client";

import { useState } from "react";

export default function ContactForm() {
  const [sent, setSent] = useState(false);
  return (
    <form onSubmit={(event) => { event.preventDefault(); setSent(true); }}>
      <label htmlFor="name">Nombre *</label>
      <input id="name" name="name" required aria-describedby="name-hint" />
      <p id="name-hint">Como quieres que te llamemos.</p>
      <label>
        Mensaje
        <textarea name="message" />
      </label>
      <input type="hidden" name="source" value="web" />
      <button type="submit">Enviar</button>
      {sent && <p role="status">Mensaje enviado</p>}
    </form>
  );
}
`;

describe("Next.js App Router conventions", () => {
  it("rejects the Pages Router contact page that Testing used to approve", () => {
    const results = runConventionChecks([
      { path: "src/pages/Contact.tsx", content: PAGES_ROUTER_CONTACT },
    ]);
    expect(failed(results)).toEqual([
      "nextjs:app-router:src/pages/Contact.tsx",
      "nextjs:use-client:src/pages/Contact.tsx",
      "a11y:label:src/pages/Contact.tsx",
    ]);
    const useClient = results.find((r) => r.name.startsWith("nextjs:use-client"));
    expect(useClient?.details).toContain("useState (línea 4)");
    expect(useClient?.details).toContain("onSubmit (línea 6)");
    expect(useClient?.details).toContain("'use client'");
  });

  it("accepts an App Router page with a separate client form", () => {
    const results = runConventionChecks([
      { path: "app/contacto/page.tsx", content: APP_ROUTER_PAGE },
      { path: "app/_components/contact-form.tsx", content: ACCESSIBLE_FORM },
    ]);
    expect(failed(results)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "nextjs:default-export:app/contacto/page.tsx",
        "nextjs:use-client:app/_components/contact-form.tsx",
        "a11y:label:app/_components/contact-form.tsx",
      ]),
    );
  });

  it("requires a default export in page and layout files", () => {
    const results = runConventionChecks([
      { path: "app/contacto/page.tsx", content: "export function Contact() { return <main />; }" },
      { path: "app/layout.tsx", content: "const Layout = () => null;\nexport { Layout as default };" },
    ]);
    expect(failed(results)).toEqual(["nextjs:default-export:app/contacto/page.tsx"]);
  });

  it("only accepts 'use client' as a leading directive", () => {
    const content = `import { useState } from "react";\n"use client";\nexport function A() { const [a] = useState(0); return <p>{a}</p>; }`;
    expect(failed(runConventionChecks([{ path: "components/a.tsx", content }]))).toEqual([
      "nextjs:use-client:components/a.tsx",
    ]);
  });

  it("does not require 'use client' for server-safe code", () => {
    const content = `import { useId } from "react";\nexport default function Field() { const id = useId(); return <><label htmlFor={id}>Nombre</label><input id={id} /></>; }`;
    const results = runConventionChecks([{ path: "components/field.tsx", content }]);
    expect(results.find((r) => r.name.startsWith("nextjs:use-client"))).toBeUndefined();
    expect(failed(results)).toEqual([]);
  });

  it("rejects metadata exported from a client component", () => {
    const content = `"use client";\nexport const metadata = { title: "x" };\nexport default function Page() { return <button onClick={() => {}}>Hola</button>; }`;
    expect(failed(runConventionChecks([{ path: "app/page.tsx", content }]))).toEqual([
      "nextjs:client-metadata:app/page.tsx",
    ]);
  });

  it("ignores non-component files", () => {
    expect(
      runConventionChecks([
        { path: "README.md", content: "# Hola" },
        { path: "lib/use-thing.ts", content: "export function useThing() { return useState(0); }" },
      ]),
    ).toEqual([]);
  });
});

describe("accessibility checks", () => {
  const check = (content: string) =>
    failed(runConventionChecks([{ path: "components/form.tsx", content: `"use client";\n${content}` }]));

  it("flags controls marked as required in their label without required", () => {
    expect(
      check(`export default function F() { return <><label htmlFor="mail">Email (obligatorio)</label><input id="mail" type="email" /></>; }`),
    ).toEqual(["a11y:required:components/form.tsx"]);
    expect(
      check(`export default function F() { return <><label htmlFor="mail">Email *</label><input id="mail" aria-required="true" /></>; }`),
    ).toEqual([]);
  });

  it("flags references to ids that do not exist", () => {
    expect(
      check(`export default function F() { return <><label htmlFor="nombre">Nombre</label><input id="name" aria-describedby="ayuda" /></>; }`),
    ).toEqual(["a11y:label:components/form.tsx", "a11y:id-refs:components/form.tsx"]);
  });

  it("accepts aria-label and skips ids it cannot verify", () => {
    expect(
      check(`export default function F({ id }: { id: string }) { return <><input aria-label="Buscar" /><label htmlFor={id}>X</label><input id={id} /><select {...{}} /></>; }`),
    ).toEqual([]);
  });

  it("flags images without alt and buttons without a name", () => {
    expect(
      check(`export default function F() { return <><img src="/a.png" /><button onClick={() => {}}><svg /></button><button aria-label="Cerrar" /></>; }`),
    ).toEqual(["a11y:img-alt:components/form.tsx", "a11y:button-name:components/form.tsx"]);
  });
});

describe("runDeterministicChecks scoping", () => {
  it("applies convention checks only to the task's files when given", () => {
    const files = [
      { path: "src/pages/Contact.tsx", content: PAGES_ROUTER_CONTACT },
      { path: "app/_components/contact-form.tsx", content: ACCESSIBLE_FORM },
    ];
    const scoped = runDeterministicChecks(files, [], {
      conventionPaths: ["app/_components/contact-form.tsx"],
    });
    expect(scoped.filter((r) => !r.passed)).toEqual([]);
    const all = runDeterministicChecks(files, []);
    expect(all.filter((r) => !r.passed).length).toBe(3);
  });

  it("reports acceptance checks in Spanish", () => {
    const [result] = runDeterministicChecks([], [{ type: "file_exists", path: "app/page.tsx" }]);
    expect(result.details).toBe("Falta el archivo obligatorio app/page.tsx.");
  });
});
