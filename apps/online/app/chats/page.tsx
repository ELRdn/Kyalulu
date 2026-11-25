import { Screen } from '../_runtime/Screen';
import Loading from './loading';

export const metadata = { title: 'Chats | Kyalulu' };
export default function Chats() {
  return <Screen path="/chats" pending={<Loading />} />;
}
