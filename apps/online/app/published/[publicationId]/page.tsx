import { DetailPage, detailMetadata } from '../../_public/catalog';

type Props = { params: Promise<{ publicationId: string }> };

export async function generateMetadata({ params }: Props) {
  return detailMetadata('published', (await params).publicationId);
}

export default async function Page({ params }: Props) {
  return <DetailPage kind="published" id={(await params).publicationId} />;
}
