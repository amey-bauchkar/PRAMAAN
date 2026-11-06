import ts from 'typescript';
import { createHash } from 'crypto';
import { CodeSymbolLocation, ParseResult } from '@pramaan/contracts';
import { ILanguageParser } from './parser-interface.js';

export class TypeScriptAstParser implements ILanguageParser {
  public readonly language = 'TypeScript/JavaScript';
  public readonly parserName = 'typescript-ast';
  public readonly parserVersion = ts.version;
  public readonly grammarVersion = 'ECMAScript 2024 / TS ' + ts.version;

  public supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.js') ||
      lower.endsWith('.jsx') ||
      lower.endsWith('.mjs') ||
      lower.endsWith('.cjs')
    );
  }

  private resolveScriptKind(filePath: string): ts.ScriptKind {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (lower.endsWith('.ts')) return ts.ScriptKind.TS;
    if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return ts.ScriptKind.JS;
    return ts.ScriptKind.Unknown;
  }

  public parse(source: Buffer | Uint8Array | string, filePath: string): ParseResult {
    const sourceText = typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
    const scriptKind = this.resolveScriptKind(filePath);

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true, // setParentNodes
      scriptKind
    );

    const errors: string[] = [];
    const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
    if (parseDiagnostics && parseDiagnostics.length > 0) {
      for (const diag of parseDiagnostics) {
        errors.push(ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
      }
    }

    const symbols: CodeSymbolLocation[] = [];

    const visit = (node: ts.Node, currentContainer?: string) => {
      if (ts.isFunctionDeclaration(node)) {
        const name = node.name ? node.name.text : 'anonymous_function';
        symbols.push(this.extractSymbol(node, sourceFile, sourceText, name, 'function', currentContainer));
      } else if (ts.isMethodDeclaration(node)) {
        const name = node.name.getText(sourceFile);
        symbols.push(this.extractSymbol(node, sourceFile, sourceText, name, 'method', currentContainer));
      } else if (ts.isConstructorDeclaration(node)) {
        symbols.push(this.extractSymbol(node, sourceFile, sourceText, 'constructor', 'method', currentContainer));
      } else if (ts.isClassDeclaration(node)) {
        const className = node.name ? node.name.text : 'anonymous_class';
        symbols.push(this.extractSymbol(node, sourceFile, sourceText, className, 'class', currentContainer));
        // Recurse into class members with className as container
        ts.forEachChild(node, child => visit(child, className));
        return;
      } else if (ts.isInterfaceDeclaration(node)) {
        const interfaceName = node.name.text;
        symbols.push(this.extractSymbol(node, sourceFile, sourceText, interfaceName, 'interface', currentContainer));
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
          ) {
            const name = decl.name.getText(sourceFile);
            symbols.push(this.extractSymbol(decl, sourceFile, sourceText, name, 'function', currentContainer));
          }
        }
      }

      ts.forEachChild(node, child => visit(child, currentContainer));
    };

    visit(sourceFile);

    return {
      success: errors.length === 0,
      parserName: this.parserName,
      parserVersion: this.parserVersion,
      grammarVersion: this.grammarVersion,
      language: this.language,
      symbols,
      errors,
    };
  }

  private extractSymbol(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    sourceText: string,
    name: string,
    kind: 'function' | 'method' | 'class' | 'interface' | 'block',
    containerName?: string
  ): CodeSymbolLocation {
    const charStart = node.getStart(sourceFile);
    const charEnd = node.getEnd();
    const lineStart = sourceFile.getLineAndCharacterOfPosition(charStart).line + 1;
    const lineEnd = sourceFile.getLineAndCharacterOfPosition(charEnd).line + 1;

    // Convert UTF-16 character offsets to true UTF-8 byte offsets
    const byteStart = Buffer.byteLength(sourceText.slice(0, charStart), 'utf8');
    const byteEnd = Buffer.byteLength(sourceText.slice(0, charEnd), 'utf8');
    const codeSpan = sourceText.slice(charStart, charEnd);
    const contentHash = createHash('sha256').update(Buffer.from(codeSpan, 'utf8')).digest('hex');

    return {
      name,
      kind,
      lineStart,
      lineEnd,
      byteStart,
      byteEnd,
      codeSpan,
      contentHash,
      containerName,
    };
  }
}
