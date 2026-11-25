export function publicOrigin() {
  const origin = process.env.KYALULU_PUBLIC_ORIGIN;
  if (!origin) throw new Error('KYALULU_PUBLIC_ORIGIN is required');
  return new URL(origin);
}
