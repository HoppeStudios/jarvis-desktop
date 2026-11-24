/** Metadata only. A successful observation is not a shutdown/update lease. */
export type ComposerDraftCounts = {
  cachedDrafts: number;
  liveDrafts: number;
  busyEditors: number;
  unknownEditors: number;
  pendingPrefill: boolean;
};
export type ComposerDraftStatusResponse = ComposerDraftCounts & { requestId: string };
export type ComposerDraftStatus =
  | { known: false; empty: false }
  | (ComposerDraftCounts & { known: true; empty: boolean; observedAt: string });
