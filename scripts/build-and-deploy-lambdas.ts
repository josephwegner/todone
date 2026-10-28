#!/usr/bin/env node
/**
 * Build every deployable Lambda into a self-contained CommonJS bundle and
 * publish it to the shared `family-paas` Lambda deployments bucket, at the
 * exact S3 key each Lambda's Terraform module resource expects.
 *
 * This is a PRODUCTION ARTIFACT PUBLISH (docs/operations/deployment-rollback.md
 * "Pre-deployment gate" / "Deployment sequence"). Running it is itself the
 * human authorization for that specific action -- it does not touch
 * Terraform state, apply infrastructure, or affect live traffic. The
 * artifact only takes effect once a human explicitly runs the reviewed
 * `terraform apply`/publish step that points a Lambda at this S3 key.
 *
 * Usage:
 *   npm run deploy:lambdas
 *   npm run deploy:lambdas -- session       # build/publish a subset by name
 *   npm run build:lambdas                   # build locally; never publish
 */
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

// Must exactly match terraform/main.tf's `module.lambdas` for_each keys.
// `lambdas/health` is a local-simulator example only and is deliberately
// excluded -- it is never deployed.
const DEPLOYABLE_LAMBDAS = {
  session: 'lambdas/session/index.ts',
  'current-membership': 'lambdas/households/current.ts',
  'create-household': 'lambdas/households/create.ts',
  profile: 'lambdas/households/profile.ts',
  'family-directory': 'lambdas/households/directory.ts',
  'create-child': 'lambdas/households/children.ts',
  'remove-child': 'lambdas/households/removeChild.ts',
  'recovery-email': 'lambdas/households/recoveryEmail.ts',
  'create-parent': 'lambdas/households/createParent.ts',
  'activate-parent': 'lambdas/households/activateParent.ts',
  'pending-parent-actions': 'lambdas/households/pendingParentActions.ts',
  'reset-child-password': 'lambdas/households/resetChildPassword.ts',
  'pre-signup': 'lambdas/pre-signup/index.ts',
} as const;

// Matches terraform/main.tf `locals.app_name` / `locals.environment`.
const APP_NAME = 'todone';
const ENVIRONMENT = 'prod';

// Matches family-paas's `shared` stack output `lambda_deployments_bucket`
// (see terraform/main.tf `data.terraform_remote_state.shared`). Update here
// if that shared output ever changes.
const DEPLOYMENTS_BUCKET = 'lambda-deployments-743837809639';

const BUILD_DIR = join(process.cwd(), '.lambda-build');
// ZIP's DOS timestamp format starts in 1980. Give every entry the same valid
// timestamp so an unchanged Lambda source produces the same release hash.
const REPRODUCIBLE_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z');

interface BuildResult {
  name: string;
  zipPath: string;
  s3Key: string;
  sha256: string;
  sourceCodeHash: string;
  sizeBytes: number;
}

async function buildLambda(name: string): Promise<BuildResult> {
  const relativeEntry = DEPLOYABLE_LAMBDAS[name as keyof typeof DEPLOYABLE_LAMBDAS];
  const entry = relativeEntry && join(process.cwd(), relativeEntry);
  if (!existsSync(entry)) {
    throw new Error(`No entry point configured for ${name}.`);
  }

  const outDir = join(BUILD_DIR, name);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const outfile = join(outDir, 'index.js');
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // Lambda validation messages share the typed English catalog with the PWA.
    // Vite handles `?raw` in browser builds; esbuild needs an explicit text loader.
    loader: { '.yml': 'text' },
    // Handler-only entry: no browser globals, no dev-only local-Cognito
    // branches are excluded here (they are gated by env vars at runtime,
    // not build time, so this bundles the same code path production uses).
  });

  const zipPath = join(BUILD_DIR, `${name}.zip`);
  rmSync(zipPath, { force: true });
  // Force CommonJS unambiguously inside the artifact, regardless of this
  // repo's own root `package.json` ("type": "module") or whatever the
  // Lambda runtime's default resolution would otherwise infer.
  const packagePath = join(outDir, 'package.json');
  writeFileSync(packagePath, JSON.stringify({ type: 'commonjs' }) + '\n');
  const catalogPath = join(outDir, 'en.yml');
  copyFileSync(join(process.cwd(), 'src', 'i18n', 'en.yml'), catalogPath);
  // `zip` (not a new dependency) keeps the artifact reproducible without
  // adding an archiving library for one build step.
  utimesSync(outfile, REPRODUCIBLE_ZIP_TIME, REPRODUCIBLE_ZIP_TIME);
  utimesSync(packagePath, REPRODUCIBLE_ZIP_TIME, REPRODUCIBLE_ZIP_TIME);
  utimesSync(catalogPath, REPRODUCIBLE_ZIP_TIME, REPRODUCIBLE_ZIP_TIME);
  execFileSync('zip', ['-qX', zipPath, 'index.js', 'package.json', 'en.yml'], { cwd: outDir });

  const bytes = readFileSync(zipPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sourceCodeHash = createHash('sha256').update(bytes).digest('base64');
  const sizeBytes = statSync(zipPath).size;
  const s3Key = `${APP_NAME}/${ENVIRONMENT}/${name}.zip`;

  return { name, zipPath, s3Key, sha256, sourceCodeHash, sizeBytes };
}

function publish(result: BuildResult): void {
  const destination = `s3://${DEPLOYMENTS_BUCKET}/${result.s3Key}`;
  execSync(`aws s3 cp "${result.zipPath}" "${destination}"`, { stdio: 'inherit' });
}

async function main(): Promise<void> {
  const buildOnly = process.argv.includes('--build-only');
  const requested = process.argv.slice(2).filter((argument) => argument !== '--build-only');
  const knownNames = Object.keys(DEPLOYABLE_LAMBDAS);
  const names = requested.length > 0 ? requested : knownNames;

  for (const name of names) {
    if (!knownNames.includes(name)) {
      throw new Error(`"${name}" is not a deployable Lambda. Known: ${knownNames.join(', ')}`);
    }
  }

  const results: BuildResult[] = [];
  for (const name of names) {
    console.log(`Building ${name}...`);
    const result = await buildLambda(name);
    if (!buildOnly) {
      console.log(`Publishing ${name} to s3://${DEPLOYMENTS_BUCKET}/${result.s3Key}...`);
      publish(result);
    }
    results.push(result);
  }

  console.log(
    `\n${buildOnly ? 'Built' : 'Published'} artifacts (record these in the release record):\n`,
  );
  for (const r of results) {
    console.log(`  ${r.name}`);
    console.log(`    s3Key:  ${r.s3Key}`);
    console.log(`    sha256: ${r.sha256}`);
    console.log(`    sourceCodeHash: ${r.sourceCodeHash}`);
    console.log(`    bytes:  ${r.sizeBytes}`);
  }
  console.log(
    '\nThese keys and sourceCodeHash values must match their Terraform inputs before `terraform apply`.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
