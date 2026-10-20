import { inject, type App, type InjectionKey } from 'vue';
import type { SessionController } from './sessionController';

const SESSION_PROVIDER_MISSING = 'SESSION_PROVIDER_MISSING';
export const sessionControllerKey: InjectionKey<SessionController> = Symbol('sessionController');

export function provideSessionController(app: App, controller: SessionController): void {
  app.provide(sessionControllerKey, controller);
}

export function useSessionController(): SessionController {
  const controller = inject(sessionControllerKey);
  if (!controller) throw new Error(SESSION_PROVIDER_MISSING);
  return controller;
}
