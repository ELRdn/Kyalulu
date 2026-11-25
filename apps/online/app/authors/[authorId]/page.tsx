import { DetailPage, detailMetadata } from '../../_public/catalog';

type Props = { params: Promise<{ authorId: string }> };

export async function generateMetadata({ params }: Props) {
  return detailMetadata('authors', (await params).authorId);
}

export default async function Page({ params }: Props) {
  return <DetailPage kind="authors" id={(await params).authorId} />;
}
