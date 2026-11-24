import ts from "typescript";
import type { DeterministicCheckResult } from "@/lib/agents/schemas";
import type { VirtualFile } from "./virtual-project";

/**
 * Deterministic checks for Next.js App Router conventions and basic form
 * accessibility. They read the TypeScript AST of generated files (never run
 * them) and only report rules that apply to a file, so a README produces no
 * noise. Messages are in Spanish: they are shown in the UI and fed back to
 * Develop as the reason a delivery was rejected.
 *
 * Heuristics stay conservative: a value that is not a literal (an `id` built
 * from props, a spread) cannot be verified and is never counted as a failure.
 */

const MAX_EXAMPLES = 3;

/** Hooks are client-only except `use` (works in Server Components) and useId. */
const SERVER_SAFE_HOOKS = new Set(["use", "useId"]);
const CONTROL_TAGS = new Set(["input", "select", "textarea"]);
const UNLABELLED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);
const REQUIRED_LABEL = /\*|obligatori|requerid|required/i;

interface Finding {
  line: number;
  text: string;
}

export function runConventionChecks(
  files: readonly VirtualFile[],
): DeterministicCheckResult[] {
  const results: DeterministicCheckResult[] = [];
  for (const file of files) {
    if (/(^|\/)pages\/.+\.(tsx|ts|jsx|js)$/.test(file.path) && !/(^|\/)app\//.test(file.path)) {
      results.push({
        name: `nextjs:app-router:${file.path}`,
        passed: false,
        details: `${file.path} usa el Pages Router. En App Router cada ruta es app/<ruta>/page.tsx (por ejemplo app/contacto/page.tsx).`,
      });
    }
    if (!/\.(tsx|jsx)$/.test(file.path)) {
      continue;
    }
    const source = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    results.push(...checkRouteFile(file.path, source));
    results.push(...checkClientBoundary(file.path, source));
    results.push(...checkAccessibility(file.path, source));
  }
  return results.map(clampResult);
}

/* ------------------------------------------------------------------ */
/* Next.js App Router                                                   */
/* ------------------------------------------------------------------ */

function checkRouteFile(path: string, source: ts.SourceFile): DeterministicCheckResult[] {
  const match = /(^|\/)app\/(?:.+\/)?(page|layout)\.(tsx|jsx)$/.exec(path);
  if (!match) {
    return [];
  }
  const kind = match[2] === "page" ? "la página" : "el layout";
  const passed = hasDefaultExport(source);
  return [
    {
      name: `nextjs:default-export:${path}`,
      passed,
      details: passed
        ? `${path} exporta por defecto ${kind}.`
        : `${path} debe exportar por defecto el componente de ${kind} (export default function …).`,
    },
  ];
}

function checkClientBoundary(path: string, source: ts.SourceFile): DeterministicCheckResult[] {
  const clientFeatures: Finding[] = [];
  visit(source, (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && /^use[A-Z]/.test(name) && !SERVER_SAFE_HOOKS.has(name)) {
        clientFeatures.push({ line: lineOf(source, node), text: name });
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      /^on[A-Z]/.test(node.name.getText(source)) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      clientFeatures.push({ line: lineOf(source, node), text: node.name.getText(source) });
    }
  });

  const isClient = hasUseClientDirective(source);
  const results: DeterministicCheckResult[] = [];
  if (clientFeatures.length > 0) {
    results.push({
      name: `nextjs:use-client:${path}`,
      passed: isClient,
      details: isClient
        ? `${path} declara 'use client' y usa ${describe(clientFeatures)}.`
        : `${path} usa ${describe(clientFeatures)}, que solo funcionan en componentes de cliente, pero no empieza con la directiva 'use client'. Añádela como primera línea o mueve la interactividad a un componente de cliente.`,
    });
  }
  if (isClient && exportsMetadata(source)) {
    results.push({
      name: `nextjs:client-metadata:${path}`,
      passed: false,
      details: `${path} exporta metadata desde un componente con 'use client'; Next.js solo la admite en Server Components. Separa la parte interactiva en otro componente.`,
    });
  }
  return results;
}

function hasUseClientDirective(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      if (statement.expression.text === "use client") {
        return true;
      }
      continue; // other directives may precede it
    }
    return false; // directives must come before any other statement
  }
  return false;
}

function hasDefaultExport(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isExportAssignment(statement) ||
      (ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false) &&
        (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false)) ||
      (ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some((element) => element.name.text === "default")),
  );
}

function exportsMetadata(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          (declaration.name.text === "metadata" || declaration.name.text === "generateMetadata"),
      ),
  ) ||
    source.statements.some(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === "generateMetadata" &&
        (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false),
    );
}

/* ------------------------------------------------------------------ */
/* Accessibility                                                        */
/* ------------------------------------------------------------------ */

interface JsxNodeInfo {
  tag: string;
  attributes: ts.JsxAttributes;
  node: ts.JsxOpeningLikeElement;
}

function checkAccessibility(path: string, source: ts.SourceFile): DeterministicCheckResult[] {
  const elements: JsxNodeInfo[] = [];
  visit(source, (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      elements.push({ tag: node.tagName.getText(source), attributes: node.attributes, node });
    }
  });
  if (elements.length === 0) {
    return [];
  }

  const ids = new Set<string>();
  let hasDynamicIds = false;
  for (const element of elements) {
    const id = attribute(element.attributes, "id");
    if (id?.kind === "literal") ids.add(id.value);
    if (id?.kind === "dynamic" || hasSpread(element.attributes)) hasDynamicIds = true;
  }

  // label htmlFor → label text, for association and "required" hints.
  const labelsFor = new Map<string, string>();
  let hasDynamicLabelTarget = false;
  for (const element of elements) {
    if (element.tag !== "label") continue;
    const target = attribute(element.attributes, "htmlFor");
    if (target?.kind === "literal") labelsFor.set(target.value, labelText(element.node, source));
    if (target?.kind === "dynamic") hasDynamicLabelTarget = true;
  }

  const results: DeterministicCheckResult[] = [];
  const controls = elements.filter((element) => {
    if (!CONTROL_TAGS.has(element.tag)) return false;
    const type = attribute(element.attributes, "type");
    return !(type?.kind === "literal" && UNLABELLED_INPUT_TYPES.has(type.value.toLowerCase()));
  });

  if (controls.length > 0) {
    const unlabelled: Finding[] = [];
    const missingRequired: Finding[] = [];
    for (const control of controls) {
      const label = accessibleLabel(control, labelsFor, source);
      if (label === null) {
        const id = attribute(control.attributes, "id");
        const unverifiable =
          hasSpread(control.attributes) || id?.kind === "dynamic" || hasDynamicLabelTarget;
        if (!unverifiable) {
          unlabelled.push({ line: lineOf(source, control.node), text: describeControl(control) });
        }
        continue;
      }
      if (
        REQUIRED_LABEL.test(label) &&
        !attribute(control.attributes, "required") &&
        !attribute(control.attributes, "aria-required")
      ) {
        missingRequired.push({ line: lineOf(source, control.node), text: describeControl(control) });
      }
    }

    results.push({
      name: `a11y:label:${path}`,
      passed: unlabelled.length === 0,
      details:
        unlabelled.length === 0
          ? `Los ${controls.length} campos de ${path} tienen un label asociado.`
          : `${path}: ${describe(unlabelled)} sin label asociado. Usa <label htmlFor="id"> con el mismo id del campo, envuélvelo en <label> o añade aria-label.`,
    });
    if (missingRequired.length > 0) {
      results.push({
        name: `a11y:required:${path}`,
        passed: false,
        details: `${path}: ${describe(missingRequired)} se presenta como obligatorio en su label, pero no tiene required ni aria-required.`,
      });
    }
  }

  // Every literal reference (htmlFor, aria-describedby, aria-labelledby,
  // aria-controls) must point to an id in the same file.
  if (!hasDynamicIds) {
    const brokenRefs: Finding[] = [];
    for (const element of elements) {
      for (const name of ["htmlFor", "aria-describedby", "aria-labelledby", "aria-controls"]) {
        const value = attribute(element.attributes, name);
        if (value?.kind !== "literal") continue;
        for (const ref of value.value.split(/\s+/).filter(Boolean)) {
          if (!ids.has(ref)) {
            brokenRefs.push({ line: lineOf(source, element.node), text: `${name}="${ref}"` });
          }
        }
      }
    }
    if (brokenRefs.length > 0) {
      results.push({
        name: `a11y:id-refs:${path}`,
        passed: false,
        details: `${path}: ${describe(brokenRefs)} apunta a un id que no existe en el archivo.`,
      });
    }
  }

  const images = elements.filter((element) => element.tag === "img" || element.tag === "Image");
  const imagesWithoutAlt = images
    .filter((image) => !attribute(image.attributes, "alt") && !hasSpread(image.attributes))
    .map((image) => ({ line: lineOf(source, image.node), text: `<${image.tag}>` }));
  if (imagesWithoutAlt.length > 0) {
    results.push({
      name: `a11y:img-alt:${path}`,
      passed: false,
      details: `${path}: ${describe(imagesWithoutAlt)} sin atributo alt (usa alt="" si es decorativa).`,
    });
  }

  const unnamedButtons = elements
    .filter(
      (element) =>
        element.tag === "button" &&
        !hasSpread(element.attributes) &&
        !attribute(element.attributes, "aria-label") &&
        !attribute(element.attributes, "aria-labelledby") &&
        !hasTextContent(element.node),
    )
    .map((element) => ({ line: lineOf(source, element.node), text: "<button>" }));
  if (unnamedButtons.length > 0) {
    results.push({
      name: `a11y:button-name:${path}`,
      passed: false,
      details: `${path}: ${describe(unnamedButtons)} sin texto ni aria-label; los lectores de pantalla no pueden nombrarlo.`,
    });
  }

  return results;
}

function accessibleLabel(
  control: JsxNodeInfo,
  labelsFor: Map<string, string>,
  source: ts.SourceFile,
): string | null {
  for (const name of ["aria-label", "aria-labelledby"]) {
    const value = attribute(control.attributes, name);
    if (value) return value.kind === "literal" ? value.value : "";
  }
  const id = attribute(control.attributes, "id");
  if (id?.kind === "literal" && labelsFor.has(id.value)) {
    return labelsFor.get(id.value) ?? "";
  }
  // Wrapped in a <label>.
  for (let parent = control.node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "label") {
      return labelText(parent.openingElement, source);
    }
  }
  return null;
}

type AttributeValue = { kind: "literal"; value: string } | { kind: "dynamic" };

function attribute(attributes: ts.JsxAttributes, name: string): AttributeValue | null {
  for (const property of attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name) continue;
    const initializer = property.initializer;
    if (!initializer) return { kind: "literal", value: "true" }; // boolean attribute
    if (ts.isStringLiteral(initializer)) return { kind: "literal", value: initializer.text };
    if (
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      (ts.isStringLiteral(initializer.expression) ||
        ts.isNoSubstitutionTemplateLiteral(initializer.expression))
    ) {
      return { kind: "literal", value: initializer.expression.text };
    }
    return { kind: "dynamic" };
  }
  return null;
}

function hasSpread(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some((property) => ts.isJsxSpreadAttribute(property));
}

/** Text inside the element whose opening tag is given (labels, buttons). */
function labelText(opening: ts.JsxOpeningLikeElement, source: ts.SourceFile): string {
  const element = opening.parent;
  if (!ts.isJsxElement(element)) return "";
  return element.children.map((child) => child.getText(source)).join(" ");
}

function hasTextContent(opening: ts.JsxOpeningLikeElement): boolean {
  const element = opening.parent;
  if (!ts.isJsxElement(element)) return false;
  let found = false;
  // Children only: the opening tag's attributes (onClick={…}) are not text.
  const callback = (node: ts.Node) => {
    if (ts.isJsxText(node) && node.text.trim()) found = true;
    if (ts.isJsxExpression(node) && node.expression) found = true; // dynamic text
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      attribute(node.attributes, "aria-label")
    ) {
      found = true;
    }
  };
  for (const child of element.children) {
    visit(child, callback);
  }
  return found;
}

function describeControl(control: JsxNodeInfo): string {
  for (const name of ["name", "id", "type"]) {
    const value = attribute(control.attributes, name);
    if (value?.kind === "literal") return `<${control.tag} ${name}="${value.value}">`;
  }
  return `<${control.tag}>`;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function describe(findings: Finding[]): string {
  const unique = findings.filter(
    (finding, index) => findings.findIndex((other) => other.text === finding.text) === index,
  );
  const shown = unique
    .slice(0, MAX_EXAMPLES)
    .map((finding) => `${finding.text} (línea ${finding.line})`)
    .join(", ");
  const rest = unique.length - MAX_EXAMPLES;
  return rest > 0 ? `${shown} y ${rest} más` : shown;
}

function clampResult(result: DeterministicCheckResult): DeterministicCheckResult {
  return {
    ...result,
    name: result.name.slice(0, 240),
    details: result.details.slice(0, 1000),
  };
}
