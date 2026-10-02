import type {Segment} from '../../lib/search/text';
// Renders search segments as text; matched words go into <mark>. No HTML from the data is ever interpreted.
export function Highlight({segments}: {segments: Segment[] | null | undefined}) {
  return <>{(segments || []).map((segment, index) => segment.hit ? <mark key={index}>{segment.text}</mark> : segment.text)}</>;
}
