// Token Radar — the entrypoint.
//
// One program, one input, one board. In order it:
//
//   1. finds the sealed snapshot (a directory holding snapshot.json, or the file itself),
//   2. parses it and refuses anything that is not the shape the model scores,
//   3. scores every pre-token protocol with the model in lib/model.ts and ranks the result,
//   4. writes /output/board.json — the ranked board the gate reads,
//   5. writes /output/data.js — the same board as a script for the dashboard,
//   6. copies dashboard/ (the page) and screenshots/ (the three captures) into /output,
//   7. writes /output/dossier.json — the summary the judge reads, via the vendored library.
//
// The gate's shape is the contract: 100..4,000 rows, ranks 1..N with implied value never
// rising as rank ascends, every watchlist slug covered, 3..12 farm steps per row (20..600
// characters each trimmed), 3..4 screenshots within their pixel and byte caps, and a dossier
// that is byte for byte what buildDossier writes from out/dashboard and out/screenshots.
//
// Node 22, the standard library only, no build step: it runs as `node main.ts`. Outside the
// grader's container MAKEFUN_OUTPUT_DIR stands in for /output:
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, SnapshotError } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The directory this file lives in: dashboard/ and screenshots/ are copied from beside it. */
const here = fileURLToPath(new URL('.', import.meta.url));

/** What the scorer's reference/gate.json allows. The caps only refuse; they never shape bytes. */
const GATE = {
  /** The dossier text's UTF-8 byte cap. The only cap that shapes the bytes it writes. */
  textMaxBytes: 65_536,
  /** Screenshots the dossier accepts: 3 to 4 images, each at most 512 KiB. */
  screenshots: { max: 4, max_bytes: 524_288 },
  /** Dashboard files the dossier accepts: at most 400 files, 4 MiB in all. */
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
} as const;

/** A dossier image's name: a letter/digit/_ first, then letters/digits/._-, 1..128 characters. */
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The number of screenshots the gate requires. */
const REQUIRED_SCREENSHOTS = 3;

/**
 * A `--flag value` or `--flag=value` argument, else `fallback`. Only a value that is the next
 * argument counts, so a trailing flag with nothing after it falls back rather than eating nothing.
 */
function arg(name: string, fallback: string): string {
  const args = process.argv;
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

/** Print a failure and stop with `code`; the message goes to stderr, the board is never half-written. */
function die(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Where the snapshot lives: a --input file, or a directory holding snapshot.json. */
function resolveSnapshot(input: string): string {
  const file = input.endsWith('.json') ? input : join(input, 'snapshot.json');
  if (!existsSync(file)) {
    die(`no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  return file;
}

/**
 * Copy one directory's regular files into `to`, skipping hidden names. Flat and shallow on
 * purpose: dashboard/ and screenshots/ are flat, and the dossier walks them the same way.
 */
function copyFlatDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** Refuse the screenshots unless there are enough and every name is one a dossier accepts. */
function checkScreenshots(names: string[]): void {
  if (names.length < REQUIRED_SCREENSHOTS) {
    const plural = names.length === 1 ? '' : 's';
    die(
      `screenshots/ holds ${names.length} image${plural}: hand in ${REQUIRED_SCREENSHOTS}, ` +
        'the board, a detail view and a filtered view',
      1,
    );
  }
  for (const name of names) {
    if (!IMAGE_NAME.test(name)) {
      die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }
}

function main(): void {
  // 1. Locate the snapshot and read it as text.
  const snapshotFile = resolveSnapshot(arg('input', '/input'));
  let snapshotText: string;
  try {
    snapshotText = readFileSync(snapshotFile, 'utf8');
  } catch {
    die(`cannot read ${snapshotFile}`, 2);
  }

  // 2. Parse it. A malformed snapshot is the input's fault, not the board's: exit 2.
  let snapshot;
  try {
    snapshot = parseSnapshot(snapshotText);
  } catch (err) {
    if (err instanceof SnapshotError) die(err.message, 2);
    throw err;
  }

  // 3. Score and rank. buildRadar runs the model over the snapshot and returns the full board
  //    plus the dashboard's compact view of it.
  const { board, radar } = buildRadar(snapshot);

  // The gate's row/rank/coverage/farm-step rules, checked here so a bad board never reaches disk.
  const issue = boardIssue(board, snapshot);
  if (issue !== null) die(`the model wrote a board the gate refuses: ${issue}`, 1);

  // 4 & 5. Write the board and the dashboard's data. board.json is an object with a `rows` array.
  const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  // 6. Copy the page and the captures into out/ so /output is a self-contained dashboard.
  copyFlatDirectory(join(here, 'dashboard'), join(out, 'dashboard'));
  const shots = copyFlatDirectory(join(here, 'screenshots'), join(out, 'screenshots'));
  checkScreenshots(shots);

  // 7. The dossier, written last: the scorer rebuilds it from /output and compares bytes. Only
  //    text_max_bytes shapes the text, so passing the gate's other caps too is safe and correct.
  const dossier = buildDossier(out, {
    text_max_bytes: GATE.textMaxBytes,
    screenshots: GATE.screenshots,
    dashboard: GATE.dashboard,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
      `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ` +
      `${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

main();
