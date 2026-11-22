import { cloudJson } from './cloud';

/** 35: "self" = declaration (e.g. Japan), "yoti" = facial age estimation, null = not offered here. */
export type AgeStatus = { method: 'self' | 'yoti' | null; verified: boolean; adult_band: boolean; result?: string };

const parse = (value: Record<string, unknown>): AgeStatus => {
  if (!['self', 'yoti', null].includes(value.method as string | null) || typeof value.verified !== 'boolean' || typeof value.adult_band !== 'boolean')
    throw Error('Invalid age status');
  return value as AgeStatus;
};
const post = (value: unknown) => ({ method: 'POST', body: JSON.stringify(value) });

export const fetchAgeStatus = async () => parse(await cloudJson('app/age'));
export const declareAdult = async () => parse(await cloudJson('app/age/declare', post({ adult: true })));
export async function startFaceCheck(): Promise<string> {
  const { url } = await cloudJson('app/age/yoti', post({}));
  if (typeof url !== 'string' || !url.startsWith('https://age.yoti.com')) throw Error('Invalid age provider response');
  return url;
}
export const finishFaceCheck = async (sessionId: string) => parse(await cloudJson('app/age/yoti/result', post({ session_id: sessionId })));
