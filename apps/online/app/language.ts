import { headers } from 'next/headers';

export async function initialLanguage() {
  const languages = (await headers()).get('accept-language') || 'ja';
  return languages.split(',')[0].trim().toLowerCase().startsWith('en') ? 'en' : 'ja';
}
