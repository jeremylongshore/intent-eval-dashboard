/** Closed error vocabulary: never carry upstream bodies, URLs or credentials. */
export type PrivateReason =
  | 'configuration_invalid'
  | 'path_rejected'
  | 'credential_rejected'
  | 'source_not_enrolled'
  | 'request_failed'
  | 'request_timeout'
  | 'response_too_large'
  | 'response_invalid'
  | 'asset_missing'
  | 'asset_ambiguous'
  | 'asset_listing_incomplete'
  | 'redirect_rejected'
  | 'collection_failed';

export class PrivateIngestError extends Error {
  constructor(readonly code: PrivateReason) {
    super(code);
    this.name = 'PrivateIngestError';
  }
}

export function safeReason(error: unknown): PrivateReason {
  return error instanceof PrivateIngestError ? error.code : 'collection_failed';
}
