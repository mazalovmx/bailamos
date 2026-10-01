// Kept free of imports so the media libraries can be used (and tested) without loading auth or the database.
export class MediaError extends Error {
  constructor(public code: string, public status: number, public retryAfter?: number) {super(code);}
}
