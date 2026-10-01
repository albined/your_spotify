const running = new Set<string>();
export const canUserImport = (userId: string) => !running.has(userId);
export function claimImportWork(userId: string) {
  if (running.has(userId))
    throw new Error("An import or review is already running");
  running.add(userId);
}
export const releaseImportWork = (userId: string) => running.delete(userId);
