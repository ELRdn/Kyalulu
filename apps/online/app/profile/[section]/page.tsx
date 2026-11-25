import { Screen } from '../../_runtime/Screen';

export const metadata = { title: 'Settings | Kyalulu' };
export default function Page() {
  return <Screen path="/profile/:section" />;
}
