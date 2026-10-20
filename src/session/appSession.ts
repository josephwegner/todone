import { loadAuthConfig } from '../config/authConfig';
import { createBrowserSessionProvider } from './browserSessionProvider';
import {
  createSessionController,
  type SessionController,
  type SessionDependencies,
} from './sessionController';
import { readSessionContext } from './sessionContext';
import { applyMembershipContext } from '../presentation/appContext';
import { observeBrowserSessionChanges } from './browserSessionChanges';
import { clearProfileTone } from '../presentation/profileTone';
import { recordDevelopmentSessionDiagnostic } from './diagnostics';

/** Called once by main; tests construct isolated app instances with the same seams. */
export function createApplicationSession(
  overrides?: Pick<SessionDependencies, 'provider' | 'account'>,
) {
  const config = overrides ? null : loadAuthConfig();
  const browser = config ? createBrowserSessionProvider(config) : null;
  const runtime = overrides ?? browser!;
  const session: SessionController = createSessionController({
    provider: runtime.provider,
    account: runtime.account,
    ...(browser ? { diagnostics: recordDevelopmentSessionDiagnostic } : {}),
    ...(browser
      ? { readBrowserGeneration: () => browser.storage.readMarker()?.generation ?? null }
      : {}),
    readContext: (credentials, signal) =>
      readSessionContext(credentials, signal, fetch, session.requestContext(false)),
    foreground: () => globalThis.document.visibilityState !== 'hidden',
    clearPrivateState() {
      applyMembershipContext(null);
      clearProfileTone();
    },
  });
  if (!browser || !config) return session;
  const changes = observeBrowserSessionChanges(config.clientId, session.reconcileBrowserAccount);
  browser.storage.setAnnouncement(changes.announce);
  return {
    ...session,
    dispose() {
      changes.close();
      session.dispose();
    },
  };
}
