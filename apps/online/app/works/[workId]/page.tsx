import { DetailPage, detailMetadata } from '../../_public/catalog';

type Props = { params: Promise<{ workId: string }> };

export async function generateMetadata({ params }: Props) {
  return detailMetadata('works', (await params).workId);
}

export default async function Page({ params }: Props) {
  return <DetailPage kind="works" id={(await params).workId} />;
}
