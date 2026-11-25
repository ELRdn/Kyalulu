/** Preserve server diagnostics while rejecting every failed HTTP response. */
export async function checkedJson(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.error ?? body?.detail ?? body?.output;
    const message = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.json();
}
