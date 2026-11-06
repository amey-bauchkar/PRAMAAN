import { ILanguageParser } from './parser-interface.js';
import { TypeScriptAstParser } from './typescript-parser.js';

export class ParserRegistry {
  private static instance: ParserRegistry;
  private parsers: ILanguageParser[] = [];

  private constructor() {
    // Register the default TypeScript/JavaScript parser
    this.register(new TypeScriptAstParser());
  }

  public static getInstance(): ParserRegistry {
    if (!ParserRegistry.instance) {
      ParserRegistry.instance = new ParserRegistry();
    }
    return ParserRegistry.instance;
  }

  public register(parser: ILanguageParser): void {
    // Avoid duplicate parser registrations
    const existingIndex = this.parsers.findIndex(
      p => p.parserName === parser.parserName && p.language === parser.language
    );
    if (existingIndex >= 0) {
      this.parsers[existingIndex] = parser;
    } else {
      this.parsers.push(parser);
    }
  }

  public getParserForFile(filePath: string): ILanguageParser | undefined {
    return this.parsers.find(p => p.supports(filePath));
  }

  public getParserByName(parserName: string, version?: string): ILanguageParser | undefined {
    return this.parsers.find(
      p => p.parserName === parserName && (!version || p.parserVersion === version)
    );
  }

  public getAllParsers(): readonly ILanguageParser[] {
    return [...this.parsers];
  }

  public clear(): void {
    this.parsers = [];
  }

  public resetToDefaults(): void {
    this.parsers = [new TypeScriptAstParser()];
  }
}

