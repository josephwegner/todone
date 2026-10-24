import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { activeMembershipRole, applyMembershipContext } from '../../presentation/appContext';
import { appRouteDefinitions } from '../../router/routes';
import { mount } from '@vue/test-utils';
import App from '../../App.vue';

describe('App', () => {
  afterEach(() => applyMembershipContext(null));

  it.each(['parent', 'child'] as const)(
    'shows only available %s navigation as links',
    async (role) => {
      activeMembershipRole.value = role;
      const router = createRouter({
        history: createMemoryHistory(),
        routes: Object.values(appRouteDefinitions).map(({ name, path }) => ({
          name,
          path,
          component: { template: '<h2>Route</h2>' },
        })),
      });
      await router.push(role === 'child' ? '/todos' : '/family');
      await router.isReady();
      const wrapper = mount(App, { global: { plugins: [router] } });
      const navigation = wrapper.get('nav');
      expect(navigation.findAll('a').map((link) => link.attributes('href'))).toEqual([
        role === 'child' ? '/todos' : '/family',
        '/profile',
        ...(role === 'parent' ? ['/security'] : []),
      ]);
      expect(navigation.get('[aria-current="page"]').attributes('href')).toBe(
        role === 'child' ? '/todos' : '/family',
      );
      expect(navigation.findAll('button')).toHaveLength(0);
      wrapper.unmount();
    },
  );

  it('has one h1, a skip link, and the production bootstrap surface', () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          RouterView: { template: '<section data-testid="production-bootstrap" />' },
        },
      },
    });
    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.get('a.skip-link').attributes('href')).toBe('#main-content');
    expect(wrapper.get('#main-content').exists()).toBe(true);
    expect(wrapper.get('[data-testid="production-bootstrap"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Temporary sign-in');
  });
});
