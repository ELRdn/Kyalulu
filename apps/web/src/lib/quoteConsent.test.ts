import { afterEach, expect, it, vi } from 'vitest';
import { QuoteConsent, validCloudQuote } from './quoteConsent';
import { setCloud, setCloudOwner } from './cloudMode';

const quote = { quote_id: 'q', max_credits: 12, expires_in: 2, route: { display_name: 'Cloud', provider: 'openrouter', upstream: 'InferenceNet', model: 'pinned-model' } };

it('validates optional destinations and disclosures before asking for consent', () => {
  const route = { ...quote.route, safety: { enabled: false },
    reasoning_effort: 'low', reasoning_summary_supported: true, privacy_note: 'policy', service_tier: 'flex' };
  expect(validCloudQuote({ ...quote, route, credit_reservation: false, safety_screening: false })).toBe(true);
  expect(validCloudQuote({ ...quote, credit_reservation: true })).toBe(false);
  expect(validCloudQuote({ ...quote, safety_screening: true })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...route, safety: { enabled: true } } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...quote.route, safety: 'sfw' } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...quote.route, safety: 'unknown-policy' } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...route, safety: null } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...route, safety: { provider: 'openrouter' } } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...route, reasoning_summary_supported: 'yes' } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...route, privacy_note: {} } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...route, retains_prompts: true } })).toBe(true);
  expect(validCloudQuote({ ...quote, route: { ...route, retains_prompts: 'true' } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...route, training: true, training_consent_required: true } })).toBe(true);
  expect(validCloudQuote({ ...quote, route: { ...route, training: 'true' } })).toBe(false);
  expect(validCloudQuote({ ...quote, route: { ...route, training_consent_required: 'true' } })).toBe(false);
});
afterEach(() => { setCloud(false); vi.useRealTimers(); });
it('requires a live quote, validates amounts and exposes only explicit confirmation', async () => {
  const notify = vi.fn(); const consent = new QuoteConsent(notify);
  const pending = consent.request(quote, new AbortController().signal, true);
  expect(notify.mock.calls[0][0]).toMatchObject({ max_credits: 12, trainingConsent: true });
  consent.accept(); expect(await pending).toBe(true); expect(notify).toHaveBeenLastCalledWith(null);
  expect(validCloudQuote({ ...quote, max_credits: -1 })).toBe(false);
  expect(validCloudQuote({ ...quote, max_credits: 0.5 })).toBe(false);
  expect(validCloudQuote({ ...quote, expires_in: -1 })).toBe(false);
  expect(validCloudQuote({ ...quote, route: {} })).toBe(false);
});
it.each(['cancel', 'abort', 'account', 'expiry'] as const)('rejects %s without accepting or restarting', async reason => {
  vi.useFakeTimers(); setCloud(true); setCloudOwner('first');
  const consent = new QuoteConsent(vi.fn()); const abort = new AbortController();
  const pending = consent.request(quote, abort.signal, false);
  if (reason === 'cancel') consent.cancel();
  if (reason === 'abort') abort.abort();
  if (reason === 'account') setCloudOwner('second');
  if (reason === 'expiry') await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toBe(false); consent.accept();
});
it('rejects the old confirmation when replaced and does not reuse its consent', async () => {
  const consent = new QuoteConsent(vi.fn());
  const first = consent.request(quote, new AbortController().signal, true);
  const second = consent.request({ ...quote, quote_id: 'q2' }, new AbortController().signal, false);
  expect(await first).toBe(false); consent.cancel(); expect(await second).toBe(false);
});
it('does not accept after expiry even when the timer is suspended', async () => {
  vi.useFakeTimers(); const consent = new QuoteConsent(vi.fn());
  const request = consent.request(quote, new AbortController().signal, false);
  vi.setSystemTime(Date.now() + 3000); consent.accept(); expect(await request).toBe(false);
});
