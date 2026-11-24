import ts from "typescript";
import { runConventionChecks } from "./conventions";
import type {
  AcceptanceCheck,
  DeterministicCheckResult,
} from "@/lib/agents/schemas";

export interface VirtualFile {
  path: string;
  content: string;
}

export interface DeterministicCheckOptions {
  /**
   * Paths whose convention checks (Next.js and accessibility) apply. Testing
   * passes the files written by the task under test, so a problem in another
   * task's file does not block this one. Defaults to every file.
   */
  conventionPaths?: readonly string[];
}

export function runDeterministicChecks(
  files: readonly VirtualFile[],
  acceptanceChecks: readonly AcceptanceCheck[],
  options: DeterministicCheckOptions = {},
): DeterministicCheckResult[] {
  const fileMap = new Map(files.map((file) => [file.path, file.content]));
  const results: DeterministicCheckResult[] = [];

  for (const file of files) {
    if (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) {
      const { diagnostics = [] } = ts.transpileModule(file.content, {
        fileName: file.path,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ESNext,
        },
        reportDiagnostics: true,
      });

      for (const diagnostic of diagnostics) {
        results.push({
          name: `syntax:${file.path}`,
          passed: false,
          details: formatDiagnostic(diagnostic),
        });
      }
    } else if (file.path.endsWith(".json")) {
      try {
        JSON.parse(file.content);
      } catch {
        results.push({
          name: `syntax:${file.path}`,
          passed: false,
          details: `${file.path} no es JSON válido.`,
        });
      }
    }
  }

  for (const check of acceptanceChecks) {
    const content = fileMap.get(check.path);
    switch (check.type) {
      case "file_exists":
        results.push({
          name: `file_exists:${check.path}`,
          passed: content !== undefined,
          details:
            content === undefined
              ? `Falta el archivo obligatorio ${check.path}.`
              : `Existe el archivo obligatorio ${check.path}.`,
        });
        break;

      case "contains_text":
        results.push({
          name: `contains_text:${check.path}`,
          passed: content?.includes(check.text) ?? false,
          // A missing file must say so: "does not contain" made Develop
          // resend an unchanged, correct file at another path (real run).
          details:
            content === undefined
              ? `El archivo ${check.path} no existe, así que no se puede comprobar que contenga «${check.text}».`
              : content.includes(check.text)
                ? `${check.path} contiene el texto requerido «${check.text}».`
                : `${check.path} no contiene el texto requerido «${check.text}».`,
        });
        break;

      case "exports_symbol": {
        const passed =
          content !== undefined &&
          (check.path.endsWith(".ts") || check.path.endsWith(".tsx")) &&
          exportsSymbol(check.path, content, check.symbol);
        results.push({
          name: `exports_symbol:${check.path}:${check.symbol}`,
          passed,
          details: passed
            ? `${check.path} exporta ${check.symbol}.`
            : content === undefined
              ? `El archivo ${check.path} no existe, así que no puede exportar ${check.symbol}.`
              : `${check.path} no exporta ${check.symbol}.`,
        });
        break;
      }
    }
  }

  const scope = options.conventionPaths ? new Set(options.conventionPaths) : null;
  results.push(
    ...runConventionChecks(files.filter((file) => !scope || scope.has(file.path))),
  );

  return results;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(
    diagnostic.messageText,
    " ",
  );
  const line =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
      : undefined;

  return line === undefined
    ? message
    : `Línea ${line}: ${message}`;
}

function exportsSymbol(
  path: string,
  content: string,
  symbol: string,
): boolean {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return sourceFile.statements.some((statement) => {
    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (
        symbol === "default" &&
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      ) {
        return true;
      }

      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isModuleDeclaration(statement)) &&
        statement.name &&
        ts.isIdentifier(statement.name) &&
        statement.name.text === symbol
      ) {
        return true;
      }

      if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === symbol,
        );
      }
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.some(
        (element) => element.name.text === symbol,
      );
    }

    return false;
  });
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  );
}
