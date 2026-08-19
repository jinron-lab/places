import type { ProviderPlaceMetadata } from "@/lib/places";

const ENGLISH_PROVIDER_LABELS: Record<string, string> = {
  餐饮服务: "Food & dining",
  中餐厅: "Chinese restaurant",
  外国餐厅: "International restaurant",
  咖啡厅: "Coffee shop",
  茶艺馆: "Tea house",
  风景名胜: "Scenic attraction",
  公园广场: "Parks & squares",
  公园: "Park",
  博物馆: "Museum",
  美术馆: "Art museum",
  科教文化服务: "Culture & education",
  购物服务: "Shopping",
  生活服务: "Local services",
  体育休闲服务: "Sports & recreation",
};

/** Adds a known English label while retaining the provider's original text. */
export function enrichProviderMetadata(metadata: ProviderPlaceMetadata): ProviderPlaceMetadata {
  const originalName = metadata.nameLocal ?? metadata.name;
  const englishName = ENGLISH_PROVIDER_LABELS[originalName];
  if (!englishName) return metadata;

  return {
    ...metadata,
    name: englishName,
    nameLocal: originalName,
  };
}
