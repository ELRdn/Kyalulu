import { Screen } from '../../_runtime/Screen';
import Loading from '../loading';

export const metadata = { title: 'Chat | Kyalulu' };
export default function Chat() {
  return <Screen path="/chats/:sessionId" pending={<Loading />} />;
}
