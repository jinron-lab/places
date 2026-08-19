import { ExploreApp } from "./explore-app";
import { HomeDashboard } from "./home-dashboard";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { mode } = await searchParams;
  return mode === "log" ? <ExploreApp initialMode="log" /> : <HomeDashboard />;
}
