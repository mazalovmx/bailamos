// Pure helpers over the dance-style tree (DanceStyle.parentId).
export type StyleNode = {id: string; slug: string; name: string; parentId: string | null};
export type StyleBranch = StyleNode & {children: StyleBranch[]};
// The style itself plus every descendant; safe against accidental cycles.
export function descendantIds(styles: readonly StyleNode[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const style of styles) if (style.parentId) children.set(style.parentId, [...(children.get(style.parentId) || []), style.id]);
  const seen = new Set<string>([id]), queue = [id];
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) || []) if (!seen.has(child)) {seen.add(child); queue.push(child);}
  return queue;
}
// Root first, the style itself last.
export function ancestors(styles: readonly StyleNode[], id: string): StyleNode[] {
  const byId = new Map(styles.map(style => [style.id, style])), path: StyleNode[] = [];
  for (let node = byId.get(id); node && !path.includes(node); node = node.parentId ? byId.get(node.parentId) : undefined) path.unshift(node);
  return path;
}
export function hasCycle(styles: readonly {id: string; parentId: string | null}[]): boolean {
  const parent = new Map(styles.map(style => [style.id, style.parentId]));
  for (const style of styles) {
    const seen = new Set<string>();
    for (let id: string | null | undefined = style.id; id; id = parent.get(id)) {
      if (seen.has(id)) return true;
      seen.add(id);
    }
  }
  return false;
}
export function buildTree(styles: readonly StyleNode[]): StyleBranch[] {
  const branches = new Map(styles.map(style => [style.id, {...style, children: [] as StyleBranch[]}])), roots: StyleBranch[] = [];
  for (const branch of branches.values()) {
    const parent = branch.parentId ? branches.get(branch.parentId) : undefined;
    (parent ? parent.children : roots).push(branch);
  }
  const sort = (list: StyleBranch[]) => {list.sort((a,b) => a.name.localeCompare(b.name)); list.forEach(branch => sort(branch.children));};
  sort(roots);
  return roots;
}
export function countBranch(branch: StyleBranch): number {return branch.children.reduce((sum, child) => sum + 1 + countBranch(child), 0);}
