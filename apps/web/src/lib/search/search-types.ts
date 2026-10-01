// Kept apart from search.ts (which talks to the database) so client components can import the list.
export const searchTypes = ['events', 'people', 'schools', 'posts', 'venues'] as const;
export type SearchType = typeof searchTypes[number];
