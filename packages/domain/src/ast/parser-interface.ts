import { ParseResult } from '@pramaan/contracts';

export interface ILanguageParser {
  readonly language: string;
  readonly parserName: string;
  readonly parserVersion: string;
  readonly grammarVersion?: string;

  supports(filePath: string): boolean;
  parse(source: Buffer | Uint8Array | string, filePath: string): ParseResult;
}
