import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {CommunityPhoto} from '../../components/community-photo';
export default async function Home({params}:{params:Promise<{locale:string}>}){
  const {locale}=await params,t=await getTranslations('App'),events='/'+locale+'/events';
  const sections=[['regular','classes','?kind=CLASS&recurring=1'],['solo','solo-jazz','?style=solo-jazz&format=SOLO'],['partner','lindy-hop','?style=lindy-hop'],['workshop','workshops','?kind=WORKSHOP&kind=MASTERCLASS&kind=INTENSIVE'],['social','social','?kind=SOCIAL']];
  return <main className="community-home"><section className="home-hero"><div><p className="eyebrow">Lindy Hop · Solo Jazz · Swing</p><h1>{t('homeTitle')}</h1><p className="intro">{t('homeIntro')}</p><div className="home-cta"><a className="button" href={events}>{t('homeFind')} ↗</a><a className="button secondary" href={'/'+locale+'/register'}>{t('homeJoin')}</a></div><p className="home-reassurance">{t('homeBrowse')}</p></div><CommunityPhoto name="hero" alt="Lindy Hop" label={t('photoSoon')} priority/></section>
    <section className="home-section"><h2>{t('homeHow')}</h2><div className="home-capabilities">{[['Discover','/events'],['Connect','/register'],['Organize','/events/new']].map(([key,path])=><a key={key} href={'/'+locale+path}><h3>{t('home'+key+'Title')} ↗</h3><p>{t('home'+key+'Text')}</p></a>)}</div></section>
    <section id="ways" className="home-section"><h2>{t('danceWays')}</h2><div className="discovery-grid">{sections.map(([key,photo,query],i)=><Link className={'discovery-card discovery-'+key} key={key} href={events+query}><CommunityPhoto name={photo} alt={t(key+'Title')} label={t('photoSoon')}/><div className="discovery-copy"><span className="eyebrow">0{i+1}</span><h3>{t(key+'Title')} ↗</h3><p>{t(key+'Text')}</p></div></Link>)}</div></section>
    <section className="tempo-banner"><h2>{t('tempoTitle')}</h2><p>{t('tempoText')}</p><div className="tempo-links">{['RELAXED','MODERATE','ENERGETIC'].map(value=><Link key={value} href={events+'?intensity='+value}>{t('intensity_'+value)} ↗</Link>)}</div></section>
    <section className="home-bottom"><div><h2>{t('beginnerTitle')}</h2><p>{t('beginnerText')}</p><Link className="button secondary" href={events+'?level=NEWCOMER&level=BEGINNER'}>{t('beginnerCta')} ↗</Link></div><div><h2>{t('hostTitle')}</h2><p>{t('hostText')}</p><Link className="button" href={events+'/new'}>{t('newEvent')} ↗</Link><Link className="home-secondary" href={'/'+locale+'/share'}>{t('announcement')} ↗</Link></div></section>
  </main>;
}
