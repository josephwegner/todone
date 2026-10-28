import type { ProfileColorId } from '../shared/profilePalette';

/** Public disposable test credentials. This module must never enter a frontend or Lambda bundle. */
export const localFixtureAccounts = [
  {
    username: 'localdev',
    password: 'LocalDevPass123!',
    displayName: 'Local Parent',
    color: 'PINE',
    role: 'parent',
    email: 'localdev@example.test',
  },
  {
    username: 'localparent2',
    password: 'LocalParent2Pass123!',
    displayName: 'Second Local Parent',
    color: 'LAKE',
    role: 'parent',
    email: 'localparent2@example.test',
  },
  {
    username: 'localchild',
    password: 'LocalChildPass123!',
    displayName: 'Local Child',
    color: 'MOSS',
    role: 'child',
  },
] as const satisfies ReadonlyArray<{
  username: string;
  password: string;
  displayName: string;
  color: ProfileColorId;
  role: 'parent' | 'child';
  email?: string;
}>;

export const LOCAL_FIXTURE_HOUSEHOLD = {
  name: 'Local Test Household',
  timezone: 'America/Chicago',
} as const;
