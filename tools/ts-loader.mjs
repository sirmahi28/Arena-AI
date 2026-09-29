/**
 * Minimal TypeScript loader for Node.
 *
 * The game's rule engine (`src/core/board.ts`) is deliberately DOM-free so it
 * can be simulated headlessly. Rather than pulling in a bundler just for the
 * test harness, we strip the type annotations with the TypeScript compiler
 * that is already a dev dependency.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const base = path.dirname(parentPath);
    const target = path.resolve(base, specifier);
    const candidates = specifier.endsWith('.ts')
      ? [target]
      : [`${target}.ts`, path.join(target, 'index.ts'), target];
    for (const c of candidates) {
      try {
        await readFile(c);
        return { url: pathToFileURL(c).href, format: 'module', shortCircuit: true };
      } catch {
        /* keep looking */
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const out = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        useDefineForClassFields: true,
      },
      fileName: url,
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
