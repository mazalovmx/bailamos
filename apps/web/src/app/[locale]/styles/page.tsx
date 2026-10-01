import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {allStyles} from '../../../lib/catalogue/data';
import {rankMatches} from '../../../lib/catalogue/search';
import {buildTree, countBranch, type StyleBranch} from '../../../lib/catalogue/tree';
import '../../styles/catalogue.css';
export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const t = await getTranslations({locale: (await params).locale, namespace: 'Catalogue'});
  return {title: t('stylesTitle'), description: t('stylesIntro')};
}
function Branches({branches, locale}: {branches: StyleBranch[]; locale: string}) {
  return <ul>{branches.map(branch => <li key={branch.id}><Link href={'/' + locale + '/styles/' + branch.slug}>{branch.name}</Link>
    {branch.children.length > 0 && <Branches branches={branch.children} locale={locale}/>}</li>)}</ul>;
}
export default async function Styles({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const {locale} = await params, raw = (await searchParams).q, q = (Array.isArray(raw) ? raw[0] : raw || '').slice(0,80).trim();
  const t = await getTranslations('Catalogue'), styles = await allStyles();
  const names = new Map(styles.map(style => [style.id, style.name])), found = q ? rankMatches(styles, q, 60) : [];
  return <main className="catalogue-page"><p className="eyebrow">{t('directory')}</p><h1>{t('stylesTitle')}</h1>
    <p className="intro">{t('stylesIntro')}</p><p className="catalogue-meta">{t('stylesCount', {count: styles.length})}</p>
    <form className="catalogue-search" role="search" action={'/' + locale + '/styles'}>
      <label>{t('searchStyles')}<input type="search" name="q" defaultValue={q} maxLength={80}/></label>
      <button className="button">{t('search')}</button>{q && <Link href={'/' + locale + '/styles'}>{t('showAll')}</Link>}
    </form>
    {q ? <section aria-labelledby="style-results"><h2 id="style-results">{t('resultsFor', {query: q})}</h2>
      {found.length ? <ul className="link-list">{found.map(style => <li key={style.id}><Link href={'/' + locale + '/styles/' + style.slug}>
        <span>{style.name}</span>{style.parentId && <small>{names.get(style.parentId)}</small>}</Link></li>)}</ul> : <p className="notice" role="status">{t('noResults')}</p>}
    </section> : <div className="style-families">{buildTree(styles).map(root => <section className="style-family" key={root.id} aria-labelledby={'family-' + root.slug}>
      <h2 id={'family-' + root.slug}><Link href={'/' + locale + '/styles/' + root.slug}>{root.name}</Link></h2>
      <p className="catalogue-meta">{t('subStylesCount', {count: countBranch(root)})}</p>
      {root.children.length > 0 && <div className="style-tree"><Branches branches={root.children} locale={locale}/></div>}
    </section>)}</div>}
  </main>;
}
