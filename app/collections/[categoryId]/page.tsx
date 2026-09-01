import { AllPlaces, CollectionDetail } from "../collections-app";
import { ALL_PLACES_COLLECTION_ID } from "@/lib/journal-views";

export default async function CategoryPage({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  if (categoryId === ALL_PLACES_COLLECTION_ID) return <AllPlaces />;
  return <CollectionDetail categoryId={categoryId} />;
}
