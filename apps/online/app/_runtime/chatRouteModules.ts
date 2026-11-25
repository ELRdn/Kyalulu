function routeModule<T>(importModule: () => Promise<{ default: T }>) {
  let loaded: { default: T } | undefined;
  let pending: Promise<{ default: T }> | undefined;
  return {
    current: () => loaded?.default,
    load() {
      return pending ??= importModule().then(module => {
        loaded = module;
        return module;
      }, error => {
        pending = undefined;
        throw error;
      });
    },
  };
}

// Share code loading between the character handoff and the destination.
// The runtime checks the account before ActiveChat can render.
export const runtimeModule = routeModule(() => import(/* webpackFetchPriority: "high" */ './Runtime'));
export const chatModule = routeModule(() => import('../../../web/src/pages/ActiveChat'));

export function preloadChatRoute() {
  void runtimeModule.load().catch(() => {});
  void chatModule.load().catch(() => {});
}
