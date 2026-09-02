/** The three substantial work surfaces that can cover the culture vessel. */
export type WorkspaceDrawer = 'culture' | 'specimens' | 'settings';

const DRAWER_EVENT = 'fluoddity:workspace-drawer-open';

/** Announce that a drawer has opened so the other surfaces can make room. */
export function announceWorkspaceDrawer(drawer: WorkspaceDrawer): void {
  window.dispatchEvent(new CustomEvent<WorkspaceDrawer>(DRAWER_EVENT, { detail: drawer }));
}

/** Close a surface when a different workspace drawer opens. */
export function closeWhenWorkspaceDrawerChanges(
  owner: WorkspaceDrawer,
  close: () => void,
): () => void {
  const listener = (event: Event): void => {
    const drawer = (event as CustomEvent<WorkspaceDrawer>).detail;
    if (drawer !== owner) close();
  };
  window.addEventListener(DRAWER_EVENT, listener);
  return () => window.removeEventListener(DRAWER_EVENT, listener);
}
