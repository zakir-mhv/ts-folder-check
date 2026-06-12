#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const cwd = process.cwd();
const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const cleanPath = f => f.replace(/\\/g, '/').replace(/\/+$/, '');

const usage = () => {
  console.error('Usage: ts-folder-check <folder> [folder2]... [--include <dir[,dir2]>]');
  console.error('  --include  Extra folders with global .d.ts files (e.g. vite-env.d.ts)');
  console.error('             that must be loaded but not type-checked.');
  process.exit(1);
};

// Folders with global .d.ts files outside the target (e.g., vite-env.d.ts) — loaded, not checked
const extraIncludes = [];
const folders = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--include' || arg.startsWith('--include=')) {
    const value = arg === '--include' ? args[(i += 1)] : arg.slice('--include='.length);
    if (!value) usage();
    extraIncludes.push(...value.split(',').map(cleanPath));
  } else if (arg.startsWith('-')) {
    console.error(`Unknown option: ${arg}`);
    usage();
  } else {
    folders.push(cleanPath(arg));
  }
}
if (folders.length === 0) usage();

// 1. Find and parse tsconfig.json (paths aliases come from here)
const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) {
  console.error(
    `tsconfig.json not found (searched: ${cwd} and above). Run the script from the project root.`,
  );
  process.exit(1);
}

const parseHost = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: d => {
    console.error(
      `Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
    );
    process.exit(1);
  },
};
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, { noEmit: true }, parseHost);

// 2. Out of the project's file list, take only those that fall into the desired folders as roots
const toPrefix = f => `${norm(path.resolve(cwd, f))}/`;
const targetPrefixes = folders.map(toPrefix);
const rootPrefixes = [...targetPrefixes, ...extraIncludes.map(toPrefix)];
const under = (file, prefixes) => {
  const n = norm(file);
  return prefixes.some(pre => n.startsWith(pre) || n === pre.slice(0, -1)); // folder or single file
};

const rootNames = parsed.fileNames.filter(f => under(f, rootPrefixes));
const targetFileCount = parsed.fileNames.filter(f => under(f, targetPrefixes)).length;
if (targetFileCount === 0) {
  console.error(`❗ No files matching tsconfig were found under "${folders.join(', ')}".`);
  console.error(`   Working directory: ${cwd}`);
  console.error(`   Write the path relative to the project root and run the script from the root.`);
  process.exit(1);
}

// 3. Create a scoped + incremental program
const hash = createHash('md5').update(folders.join('|')).digest('hex').slice(0, 8);
mkdirSync(path.join(cwd, '.tscheck'), { recursive: true });
const program = ts.createIncrementalProgram({
  rootNames,
  options: {
    ...parsed.options,
    noEmit: true,
    incremental: true,
    tsBuildInfoFile: path.join(cwd, '.tscheck', `buildinfo-${hash}`),
  },
});

// IMPORTANT: If we call getSemanticDiagnostics() without arguments, TS type-checks
// ALL files in the import chain (which could be hundreds). We only need to check
// the files in the target folder — imports are parsed (for types), but not
// deeply checked. In a large project, the performance difference is more than 10x.
const targetSources = program
  .getProgram()
  .getSourceFiles()
  .filter(
    sf => !norm(sf.fileName).includes('/node_modules/') && under(sf.fileName, targetPrefixes),
  );

const all = [
  ...program.getConfigFileParsingDiagnostics(),
  ...program.getOptionsDiagnostics(),
  ...program.getGlobalDiagnostics(),
];
for (const sf of targetSources) {
  all.push(...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf));
}
program.emit(); // Since noEmit is active, it only writes the incremental cache (.tsbuildinfo)

// 4. Do NOT HIDE config/global issues — show them clearly
const flatten = d => ts.flattenDiagnosticMessageText(d.messageText, '\n  ');
for (const d of all.filter(d => !d.file)) {
  console.error(`⚠️  Config: TS${d.code}: ${flatten(d)}`);
}

// 5. Select diagnostics only from the target folders (excluding node_modules)
const format = d => {
  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
  const rel = path.relative(cwd, d.file.fileName).replace(/\\/g, '/');
  const cat = d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning';
  return `${rel}(${line + 1},${character + 1}): ${cat} TS${d.code}: ${flatten(d)}`;
};

const hits = all.filter(
  d =>
    d.file &&
    !norm(d.file.fileName).includes('/node_modules/') &&
    under(d.file.fileName, targetPrefixes),
);

if (hits.length === 0) {
  console.log(
    `✅ ${folders.join(', ')} — ${targetFileCount} file(s) checked, no TypeScript errors found`,
  );
  process.exit(0);
}
console.log(`❌ ${hits.length} problem(s) found (${targetFileCount} file(s) checked):\n`);
console.log(hits.map(format).join('\n'));
process.exit(hits.some(d => d.category === ts.DiagnosticCategory.Error) ? 1 : 0);
