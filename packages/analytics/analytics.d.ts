export type AnalyticsConsent = 'granted' | 'denied' | null;
export type AnalyticsEvent = 'page_view' | 'local_install_guide_open' | 'cloud_open' | 'login' | 'chat_completed' | 'chat_reopened';
export function initAnalytics(options?: { measurementId?: string; language?: string; cloud?: boolean }): boolean;
export function analyticsEvent(name: AnalyticsEvent, props?: { page_kind?: string; language?: string }): boolean;
export function analyticsConsent(value?: Exclude<AnalyticsConsent, null>): AnalyticsConsent;
export function subscribeAnalyticsConsent(listener: (consent: AnalyticsConsent) => void): () => void;
