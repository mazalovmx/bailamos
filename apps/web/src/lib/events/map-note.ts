// The note shown with an event on the map: at most two sentences and a small number of words.
// Pure module, shared by the form (live counter) and the server (validation).
export const MAP_NOTE_WORDS = 30, MAP_NOTE_SENTENCES = 2;
export const countWords = (text: string) => (text.trim().match(/\S+/g) || []).length;
// A sentence ends with ., !, ? or … followed by a space or the end; "12.30" and "St." inside a line do not end one.
export const countSentences = (text: string) => text.trim().split(/(?<=[.!?…])\s+(?=\S)/).filter(part => part.trim()).length;
export const mapNoteProblem = (text: string) => countWords(text) > MAP_NOTE_WORDS || countSentences(text) > MAP_NOTE_SENTENCES ? 'MAP_NOTE_TOO_LONG' : null;
