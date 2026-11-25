import { BrowsePage } from '../_public/catalog';

export const metadata = { title: 'Explore | Kyalulu' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <BrowsePage path="/discover" query={await searchParams} />;
}
