import { afterEach, describe, expect, it } from 'vitest';
import { ProfileColor } from '../../../shared/profilePalette';
import { applyProfileTone, clearProfileTone } from '../../presentation/profileTone';

describe('profile presentation context', () => {
  afterEach(clearProfileTone);

  it.each(Object.values(ProfileColor))(
    'selects the reviewed %s tone without inline color overrides',
    (color) => {
      applyProfileTone(color);
      expect(document.documentElement.dataset.profileColor).toBe(color);
      expect(document.documentElement.style.length).toBe(0);
      clearProfileTone();
      expect(document.documentElement.hasAttribute('data-profile-color')).toBe(false);
    },
  );
});
