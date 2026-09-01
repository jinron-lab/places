import { AllPlacesPlaceDetail } from "../../collections-app";
import { ALL_PLACES_COLLECTION_ID } from "@/lib/journal-views";

export default async function PlacePage({ params }: { params: Promise<{ categoryId: string; placeId: string }> }) {
  const { categoryId, placeId } = await params;
  if (categoryId !== ALL_PLACES_COLLECTION_ID) return null;
  return <AllPlacesPlaceDetail placeId={placeId} />;
}
