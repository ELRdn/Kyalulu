import { BrowsePage } from '../_public/catalog';

export const metadata = { title: 'Approved works | Kyalulu' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <BrowsePage path="/published" query={await searchParams} />;
}
