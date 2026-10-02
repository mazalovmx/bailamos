import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {CommunityPhoto} from '../../components/community-photo';
import {featuredPosts} from '../../lib/home/instagram';
export default async function Home({params}:{params:Promise<{locale:string}>}){
  const {locale}=await params,t=await getTranslations('App'),base='/'+locale,events=base+'/events';
  const sections=[['regular','classes','?kind=CLASS&recurring=1'],['solo','solo-jazz','?style=solo-jazz&format=SOLO'],['partner','lindy-hop','?style=lindy-hop'],['workshop','workshops','?kind=WORKSHOP&kind=MASTERCLASS&kind=INTENSIVE'],['social','social','?kind=SOCIAL']];
  // What the site is for, in five words: each one opens the matching search.
  const kinds=[['Events',events],['Socials',events+'?kind=SOCIAL'],['Classes',base+'/classes'],['Schools',base+'/schools'],['Masterclasses',events+'?kind=MASTERCLASS&kind=WORKSHOP']];
  const posts=featuredPosts();
  return <main className="community-home"><section className="home-hero"><div><p className="eyebrow">Lindy Hop · Solo Jazz · Swing</p><h1>{t('homeTitle')}</h1><p className="intro">{t('homeIntro')}</p><div className="home-cta"><a className="button" href={events}>{t('homeFind')} ↗</a><a className="button secondary" href={base+'/register'}>{t('homeJoin')}</a></div><p className="home-reassurance">{t('homeBrowse')}</p></div><CommunityPhoto name="hero" alt="Lindy Hop" label={t('photoSoon')} priority/></section>
    <section className="home-section home-what" aria-labelledby="home-what"><h2 id="home-what">{t('homeWhatTitle')}</h2><p>{t('homeWhatText')}</p>
      <ul className="home-kinds">{kinds.map(([key,href])=><li key={key}><Link href={href}>{t('homeKind'+key)} ↗</Link></li>)}</ul>
      <p className="home-create"><Link className="button secondary" href={events+'/new'}>{t('newEvent')} ↗</Link></p>
      <div className="home-share"><div><h3>{t('homeShareTitle')}</h3><p>{t('homeShareText')}</p></div><Link className="button" href={base+'/share'}>{t('homeShareCta')} ↗</Link></div></section>
    <section className="home-section" aria-labelledby="home-school"><h2 id="home-school">{t('homeSchoolTitle')}</h2><p>{t('homeSchoolText')}</p>
      <ol className="home-steps">{[['school-profile','1'],['school-event','2']].map(([file,step])=><li key={file}><figure><img src={'/images/guide/'+file+'.webp'} width={900} height={300} loading="lazy" decoding="async" alt={t('homeSchoolAlt'+step)}/><figcaption><strong>{step}.</strong> {t('homeSchoolStep'+step)}</figcaption></figure></li>)}</ol>
      <p><Link href={base+'/schools'}>{t('homeSchoolBrowse')} ↗</Link></p></section>
    {posts.length>0&&<section className="home-section" aria-labelledby="home-instagram"><h2 id="home-instagram">{t('homeInstagramTitle')}</h2><p>{t('homeInstagramText')}</p>
      {/* A keyboard user can scroll the strip: it is focusable and labelled. */}
      <div className="home-instagram" role="group" aria-labelledby="home-instagram" tabIndex={0}>{posts.map((post,i)=><div className="ig-frame" key={post.code}>
        <iframe src={post.embedUrl} title={t('homeInstagramPost',{number:i+1})} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/>
        <a href={post.permalink} target="_blank" rel="nofollow noopener">{t('homeInstagramOpen')} ↗</a></div>)}</div></section>}
    <section id="ways" className="home-section"><h2>{t('danceWays')}</h2><div className="discovery-grid">{sections.map(([key,photo,query],i)=><Link className={'discovery-card discovery-'+key} key={key} href={events+query}><CommunityPhoto name={photo} alt={t(key+'Title')} label={t('photoSoon')}/><div className="discovery-copy"><span className="eyebrow">0{i+1}</span><h3>{t(key+'Title')} ↗</h3><p>{t(key+'Text')}</p></div></Link>)}</div></section>
    <section className="tempo-banner"><h2>{t('tempoTitle')}</h2><p>{t('tempoText')}</p><div className="tempo-links">{['RELAXED','MODERATE','ENERGETIC'].map(value=><Link key={value} href={events+'?intensity='+value}>{t('intensity_'+value)} ↗</Link>)}</div></section>
  </main>;
}
