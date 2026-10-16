import { useEffect, useState } from 'react';
import { CapabilitiesSchema, type Capabilities } from '../../../../packages/schemas/src';
import { apiFetch } from './transport';
import { connectionScope } from './remoteStore';

export async function fetchCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const response = await apiFetch('/api/capabilities', { signal, cache: 'no-store' });
  if (!response.ok) throw Object.assign(new Error(`機能情報の取得に失敗しました (HTTP ${response.status})`), { status: response.status });
  return CapabilitiesSchema.parse(await response.json());
}

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const scope = connectionScope();
  useEffect(() => {
    const controller = new AbortController();
    setCapabilities(null); setError('');
    fetchCapabilities(controller.signal).then(value => {
      if (!controller.signal.aborted && scope === connectionScope()) setCapabilities(value);
    }).catch(error => { if (!controller.signal.aborted && scope === connectionScope()) setError(String(error)); });
    return () => controller.abort();
  }, [scope, retry]);
  return { capabilities, error, reload: () => setRetry(value => value + 1) };
}
