import dotenv from 'dotenv';

// Load .env.local FIRST so COGNITO_* server-side env vars (written by
// scripts/setup-local-cognito.ts) are available before anything else runs.
dotenv.config({ path: '.env.local' });

import express from 'express';
import { handler as removeChildHandler } from '../lambdas/households/removeChild';
import { handler as recoveryEmailHandler } from '../lambdas/households/recoveryEmail';
import {
  createParentHandler,
  activateParentHandler,
  pendingParentActionHandler,
} from '../lambdas/households/parentHandlers';
import { simulateLambda } from './lambdaSimulator';
import { handler as healthHandler } from '../lambdas/health/index';
import { handler as sessionHandler } from '../lambdas/session/index';
import { handler as currentMembershipHandler } from '../lambdas/households/current';
import { handler as createHouseholdHandler } from '../lambdas/households/create';
import { handler as familyDirectoryHandler } from '../lambdas/households/directory';
import { handler as createChildHandler } from '../lambdas/households/children';
import { handler as resetChildPasswordHandler } from '../lambdas/households/resetChildPassword';
import {
  readHandler as readProfileHandler,
  updateHandler as updateProfileHandler,
} from '../lambdas/households/profile';
import { InMemoryHouseholdRepository } from '../lambdas/households/repository';
import { loadLocalSeed } from './seedHousehold';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const householdRepository = new InMemoryHouseholdRepository();
if (await loadLocalSeed(householdRepository)) {
  console.log('Loaded the disposable local review household: two active parents and one child.');
}

app.use(express.json());
app.use(
  (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError) {
      res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'The request body must be valid JSON.' } });
      return;
    }
    next(error);
  },
);

app.get('/api/v1/health', async (req, res) => {
  await simulateLambda(healthHandler, req, res);
});

app.get('/api/v1/session', async (req, res) => {
  await simulateLambda(sessionHandler, req, res);
});

app.get('/api/v1/memberships/current', async (req, res) => {
  await simulateLambda(
    (event) => currentMembershipHandler(event, { repository: householdRepository }),
    req,
    res,
  );
});

app.post('/api/v1/households', async (req, res) => {
  await simulateLambda(
    (event) => createHouseholdHandler(event, { repository: householdRepository }),
    req,
    res,
  );
});

app.get('/api/v1/profiles/me', async (req, res) => {
  await simulateLambda(
    (event) => readProfileHandler(event, { repository: householdRepository }),
    req,
    res,
  );
});

app.get('/api/v1/family-members', async (req, res) => {
  await simulateLambda(
    (event) => familyDirectoryHandler(event, { repository: householdRepository }),
    req,
    res,
  );
});

app.post('/api/v1/family-members/children', async (req, res) => {
  await simulateLambda(
    (event) => createChildHandler(event, { repository: householdRepository }),
    req,
    res,
  );
});

app.put('/api/v1/family-members/:memberId/password', async (req, res) => {
  await simulateLambda(
    (event) =>
      resetChildPasswordHandler(event, {
        repository: householdRepository,
        passwordResetAvailable: false,
      }),
    req,
    res,
  );
});

app.put('/api/v1/profiles/me', async (req, res) => {
  await simulateLambda(
    (event) => updateProfileHandler(event, { repository: householdRepository }),
    req,
    res,
  );
});

app.post('/api/v1/family-members/parents', async (req, res) => {
  await simulateLambda(
    (event) => createParentHandler(event, { repository: householdRepository }),
    req,
    res,
  );
});
app.post('/api/v1/parent-activations', async (req, res) => {
  await simulateLambda(
    (event) =>
      activateParentHandler(event, { repository: householdRepository, activationAvailable: false }),
    req,
    res,
  );
});
for (const [method, path] of [
  ['post', '/api/v1/family-members/:memberId/welcome-email-resends'],
  ['put', '/api/v1/family-members/:memberId/pending-email'],
  ['delete', '/api/v1/family-members/:memberId/pending-account'],
] as const) {
  app[method](path, async (req, res) => {
    await simulateLambda(
      (event) => pendingParentActionHandler(event, { repository: householdRepository }),
      req,
      res,
    );
  });
}

for (const method of ['get', 'put'] as const) {
  app[method]('/api/v1/security/recovery-email', async (req, res) =>
    simulateLambda(
      (event) =>
        recoveryEmailHandler(event, {
          repository: householdRepository,
          activationAvailable: false,
        }),
      req,
      res,
    ),
  );
}
app.delete('/api/v1/family-members/:memberId', async (req, res) =>
  simulateLambda(
    (event) => removeChildHandler(event, { repository: householdRepository }),
    req,
    res,
  ),
);
const server = app.listen(PORT, () => {
  console.log(`Todone local API simulator running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET /api/v1/health');
  console.log('  GET /api/v1/session');
  console.log('  GET /api/v1/memberships/current');
  console.log('  POST /api/v1/households');
  console.log('  GET /api/v1/profiles/me');
  console.log('  PUT /api/v1/profiles/me');
  console.log('  GET /api/v1/family-members');
  console.log('  POST /api/v1/family-members/children');
});

// tsx currently lets this module exit after the Express listener is initialized.
// Keep one deliberate timer handle open under `concurrently`, then release it
// after closing the listener when the parent development process stops.
const keepAlive = setInterval(() => undefined, 60 * 60 * 1000);
let isClosing = false;
const closeServer = () => {
  if (isClosing) return;
  isClosing = true;
  server.close(() => clearInterval(keepAlive));
};

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);
