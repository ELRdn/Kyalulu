import { initialLanguage } from '../language';
import { ChatPending } from './ChatPending';

export default async function Loading() {
  return <ChatPending english={await initialLanguage() === 'en'} />;
}
