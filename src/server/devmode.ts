/** Developer mode (VAULTAI_DEV=1) exposes the Demo connector used by tests and tool authors. */
export function isDevMode(): boolean {
  return process.env.VAULTAI_DEV === '1';
}
