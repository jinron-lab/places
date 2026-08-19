import { CollectionDetail } from "../collections-app";

export default async function CategoryPage({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  return <CollectionDetail categoryId={categoryId} />;
}
