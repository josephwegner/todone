import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  openSync,
  closeSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ListUserPoolsCommand } from '@aws-sdk/client-cognito-identity-provider';
import { setupLocalCognito, createLocalCognitoClient, upsertLocalAccount } from './cognitoSetup';
import { LocalDevelopment, requireLocalCognitoEndpoint } from './configuration';
import { localFixtureAccounts } from './fixtures';
import { validateSeedManifest, type LocalSeedManifest } from './seedHousehold';

export function isPortListening(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(true)); // An indeterminate listener must not permit a wipe.
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish(
        !['ECONNREFUSED', 'EAFNOSUPPORT', 'ENETUNREACH', 'EADDRNOTAVAIL'].includes(
          error.code ?? '',
        ),
      ),
    );
  });
}

/** All refusal checks precede filesystem deletion and emulator startup. No process is stopped here. */
export async function assertLocalResetSafe(
  rootDirectory: string,
  environment: Record<string, string | undefined> = process.env,
  probe = isPortListening,
): Promise<void> {
  requireLocalCognitoEndpoint(environment);
  const paths = [
    '.cognito',
    '.cognito/db',
    '.cognito/config.json',
    '.env.local',
    LocalDevelopment.seedDirectory,
    join(LocalDevelopment.seedDirectory, LocalDevelopment.seedFile),
    join(LocalDevelopment.seedDirectory, `${LocalDevelopment.seedFile}.tmp`),
    join(LocalDevelopment.seedDirectory, 'reset.lock'),
  ];
  for (const relative of paths) {
    const path = join(rootDirectory, relative);
    try {
      if (lstatSync(path).isSymbolicLink())
        throw new Error('Local reset refuses symlinked data/configuration paths.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (
    ['reset.lock', `${LocalDevelopment.seedFile}.tmp`].some((name) =>
      existsSync(join(rootDirectory, LocalDevelopment.seedDirectory, name)),
    )
  )
    throw new Error(
      'Local reset found an unfinished reset lock or temporary manifest. Stop any reset process and remove the stale generated file before retrying; nothing was deleted.',
    );
  const config = JSON.parse(readFileSync(join(rootDirectory, '.cognito/config.json'), 'utf8'));
  if (
    Object.keys(config).some((key) => !['TokenConfig', 'UserPoolDefaults'].includes(key)) ||
    JSON.stringify(config.TokenConfig) !==
      JSON.stringify({ IssuerDomain: LocalDevelopment.cognitoEndpoint }) ||
    JSON.stringify(config.UserPoolDefaults) !== JSON.stringify({ UsernameAttributes: [] })
  )
    throw new Error(
      'Local reset requires the repository emulator configuration; custom service/network configuration is refused.',
    );
  const checks = await Promise.all(
    [LocalDevelopment.pwaPort, LocalDevelopment.apiPort, LocalDevelopment.cognitoPort].flatMap(
      (port) =>
        ['127.0.0.1', '::1'].map(async (host) => ({ port, listening: await probe(port, host) })),
    ),
  );
  const active = checks.find((check) => check.listening);
  if (active)
    throw new Error(
      `Port ${active.port} is in use. Stop the local stack or SSH listener before resetting; nothing was deleted.`,
    );
}

async function stopOwnedEmulator(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  timeout.unref();
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

/** Owns only a temporary loopback emulator, never an already-running service or remote pool. */
export async function resetLocalDatabase(
  rootDirectory: string,
  signal: AbortSignal,
): Promise<void> {
  await assertLocalResetSafe(rootDirectory);
  signal.throwIfAborted();
  const seedDirectory = join(rootDirectory, LocalDevelopment.seedDirectory);
  const seedPath = join(seedDirectory, LocalDevelopment.seedFile);
  const temporarySeedPath = `${seedPath}.tmp`;
  mkdirSync(seedDirectory, { recursive: true, mode: 0o700 });
  let lock: number;
  try {
    lock = openSync(join(seedDirectory, 'reset.lock'), 'wx', 0o600);
  } catch {
    throw new Error(
      'Local reset is already running or its lock cannot be created; nothing was deleted.',
    );
  }
  try {
    // Targets are fixed under the source repository and preflight rejects symlinked parents.
    rmSync(seedPath, { force: true });
    rmSync(join(rootDirectory, '.cognito/db'), { force: true, recursive: true });
    const child = spawn(
      process.execPath,
      [join(rootDirectory, 'node_modules/cognito-local/lib/bin/start.js')],
      {
        cwd: rootDirectory,
        env: { ...process.env, HOST: 'localhost', PORT: String(LocalDevelopment.cognitoPort) },
        stdio: 'ignore', // Emulator messages can contain local passwords/codes; never forward them.
      },
    );
    let spawnFailed = false;
    child.once('error', () => {
      spawnFailed = true;
    });
    const client = createLocalCognitoClient();
    try {
      const deadline = Date.now() + 15000;
      while (true) {
        signal.throwIfAborted();
        if (spawnFailed || child.exitCode !== null || Date.now() > deadline)
          throw new Error('Temporary local emulator did not start.');
        try {
          await client.send(new ListUserPoolsCommand({ MaxResults: 1 }), { abortSignal: signal });
          break;
        } catch {
          await delay(100, undefined, { signal });
        }
      }
      const setup = await setupLocalCognito(rootDirectory, null);
      const manifest: LocalSeedManifest = {
        version: LocalDevelopment.seedVersion,
        userPoolId: setup.userPoolId,
        accounts: {},
      };
      try {
        for (const account of localFixtureAccounts) {
          signal.throwIfAborted();
          manifest.accounts[account.username] = await upsertLocalAccount(
            setup.client,
            setup.userPoolId,
            account.username,
            account.password,
            'email' in account ? account.email : undefined,
          );
        }
      } finally {
        setup.client.destroy();
      }
      signal.throwIfAborted();
      validateSeedManifest(manifest, setup.userPoolId);
      mkdirSync(seedDirectory, { recursive: true, mode: 0o700 });
      if (existsSync(temporarySeedPath))
        throw new Error('Unexpected temporary seed file; remove it before retrying.');
      const temporaryFile = openSync(temporarySeedPath, 'wx', 0o600);
      try {
        writeFileSync(temporaryFile, JSON.stringify(manifest, null, 2) + '\n');
      } catch (error) {
        rmSync(temporarySeedPath, { force: true });
        throw error;
      } finally {
        closeSync(temporaryFile);
      }
      try {
        renameSync(temporarySeedPath, seedPath);
      } catch (error) {
        rmSync(temporarySeedPath, { force: true });
        throw error;
      }
    } catch (error) {
      rmSync(seedPath, { force: true });
      throw error;
    } finally {
      client.destroy();
      await stopOwnedEmulator(child);
    }
  } finally {
    closeSync(lock);
    rmSync(join(seedDirectory, 'reset.lock'), { force: true });
  }
}
