import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, onMounted } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createSessionController } from '../../session/sessionController';
import { sessionControllerKey, useSessionController } from '../../session/injection';

describe('session injection', () => {
  it('gives simultaneous mounted consumers the same readonly lifecycle and one initialization', async () => {
    const restore = vi.fn(async () => ({ kind: 'signed-out' as const }));
    const controller = createSessionController({
      provider: { restore, signIn: vi.fn(), signOut: vi.fn() },
      readContext: vi.fn(),
    });
    const Consumer = defineComponent({
      setup() {
        const session = useSessionController();
        onMounted(() => session.initialize());
        return () => h('p', session.state.value.kind);
      },
    });
    const wrapper = mount(() => h('div', [h(Consumer), h(Consumer)]), {
      global: { provide: { [sessionControllerKey as symbol]: controller } },
    });
    await flushPromises();
    expect(restore).toHaveBeenCalledOnce();
    expect(wrapper.findAll('p').map((p) => p.text())).toEqual(['signed-out', 'signed-out']);
    wrapper.unmount();
    controller.dispose();
  });
});
