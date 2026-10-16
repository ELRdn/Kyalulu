import { cloudEpoch, subscribeCloudIdentity } from './cloudMode';

export type CloudQuote = {
  quote_id: string; max_credits: number; expires_in?: number;
  credit_reservation?: false; safety_screening?: false;
  route: {
    display_name: string; provider: string; upstream?: string; model: string;
    safety?: { enabled: false };
    reasoning_effort?: string | null; reasoning_summary_supported?: boolean;
    privacy_note?: string | null; service_tier?: string | null;
    retains_prompts?: boolean;
    training?: boolean; training_consent_required?: boolean;
  };
};
export type PendingQuote = CloudQuote & { expiresAt: number; trainingConsent: boolean; providerTrainingConsent?: boolean };
export type QuoteConfirmation = (quote: CloudQuote, signal: AbortSignal, trainingConsent: boolean) => Promise<boolean>;

export function validCloudQuote(value: unknown): value is CloudQuote {
  const q = value as CloudQuote | null;
  return !!q && typeof q.quote_id === 'string' && !!q.quote_id && Number.isSafeInteger(q.max_credits) && q.max_credits >= 0 &&
    (q.credit_reservation === undefined || q.credit_reservation === false) &&
    (q.safety_screening === undefined || q.safety_screening === false) &&
    (!('expires_in' in q) || typeof q.expires_in === 'number' && Number.isFinite(q.expires_in) && q.expires_in > 0) &&
    !!q.route && ['display_name', 'provider', 'model'].every(key => typeof q.route[key as keyof CloudQuote['route']] === 'string' && !!q.route[key as keyof CloudQuote['route']]) &&
    (q.route.upstream === undefined || typeof q.route.upstream === 'string') &&
    ['reasoning_effort', 'privacy_note', 'service_tier'].every(key => {
      const value = q.route[key as 'reasoning_effort' | 'privacy_note' | 'service_tier'];
      return value === undefined || value === null || typeof value === 'string';
    }) &&
    (q.route.reasoning_summary_supported === undefined || typeof q.route.reasoning_summary_supported === 'boolean') &&
    ['retains_prompts', 'training', 'training_consent_required'].every(key => {
      const value = q.route[key as 'retains_prompts' | 'training' | 'training_consent_required'];
      return value === undefined || typeof value === 'boolean';
    }) &&
    (q.route.safety === undefined || !!q.route.safety && q.route.safety.enabled === false);
}

/** One explicit confirmation per immutable quote; invalidation never resubmits. */
export class QuoteConsent {
  private finish: ((accepted: boolean) => void) | null = null;
  private pending: PendingQuote | null = null;
  constructor(private notify: (quote: PendingQuote | null) => void) {}
  request: QuoteConfirmation = (quote, signal, trainingConsent) => {
    this.cancel();
    if (signal.aborted || !validCloudQuote(quote)) return Promise.resolve(false);
    const identity = cloudEpoch();
    const expiresAt = Date.now() + (quote.expires_in ?? 120) * 1000;
    return new Promise<boolean>(resolve => {
      const settle = (accepted: boolean) => {
        clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', abort);
        this.finish = null; this.pending = null; this.notify(null);
        resolve(accepted && !signal.aborted && identity === cloudEpoch() && Date.now() < expiresAt);
      };
      const abort = () => settle(false);
      const unsubscribe = subscribeCloudIdentity(abort);
      const timer = setTimeout(abort, Math.min(expiresAt - Date.now(), 2147483647));
      this.finish = settle;
      signal.addEventListener('abort', abort, { once: true });
      this.pending = { ...quote, expiresAt, trainingConsent, providerTrainingConsent: false };
      this.notify(this.pending);
    });
  };
  acknowledgeProviderTraining(quoteId: string, checked: boolean) {
    if (!this.pending || this.pending.quote_id !== quoteId || this.pending.route.training_consent_required !== true) return;
    this.pending = { ...this.pending, providerTrainingConsent: checked };
    this.notify(this.pending);
  }
  accept() {
    if (this.pending?.route.training_consent_required === true && !this.pending.providerTrainingConsent) return;
    this.finish?.(true);
  }
  cancel() { this.finish?.(false); }
}
