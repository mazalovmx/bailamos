export type SearchQuery = Record<string, string | string[] | undefined>;
export function values(value: SearchQuery[string]): string[] {
  return [...new Set((Array.isArray(value) ? value : value ? [value] : []).filter(Boolean))].slice(0,100);
}
export function first(value: SearchQuery[string]): string { return values(value)[0] || ''; }
export function queryParams(query: SearchQuery): URLSearchParams {
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(query)) for(const item of values(value)) params.append(key,item);
  return params;
}
