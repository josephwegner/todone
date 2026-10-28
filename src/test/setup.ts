// Global test setup for component/unit tests.
// Kept intentionally minimal: no DOM matcher library is added until a real
// need justifies the dependency (see AGENTS.md: no unjustified dependencies).

// jsdom omits native dialog methods. Browser suites exercise the real modal/focus implementation.
if (globalThis.HTMLDialogElement && !globalThis.HTMLDialogElement.prototype.close) {
  Object.defineProperties(globalThis.HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: globalThis.HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: globalThis.HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new globalThis.Event('close'));
      },
    },
  });
}
