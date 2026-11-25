import { DeviceScreen } from './screen';

// The same document boots every device-local hash URL, including offline after restart.
export const dynamic = 'force-static';
export const metadata = { title: 'Kyalulu' };

export default function DevicePage() {
  return <DeviceScreen />;
}
