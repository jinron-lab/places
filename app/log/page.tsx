import { LogPlaceApp } from "./log-place-app";

export default async function LogPlacePage({ searchParams }: PageProps<"/log">) {
  const { place } = await searchParams;
  return <LogPlaceApp selectedPlaceId={typeof place === "string" ? place : undefined} />;
}
