import { PersonDetail } from "../people-app";

export default async function PersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  return <PersonDetail personId={personId} />;
}
