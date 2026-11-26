export type WorkspaceDesktop = {
  onPrepareClose(listener: (token: string) => void): () => void;
  finishClose(token: string, ready: boolean): void;
  exportJson(text: string): Promise<'saved' | 'cancelled' | 'failed'>;
};
declare global {
  interface Window { educationWorkspace?: WorkspaceDesktop }
}
