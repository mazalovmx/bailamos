import {getTranslations} from 'next-intl/server';
const photos:Record<string,{file:string;ratio:string;description:string}>={
  hero:{file:'hero.png',ratio:'1122 / 1402',description:'photoHeroAlt'},
  classes:{file:'classes.png',ratio:'1448 / 1086',description:'photoClassesAlt'},
  'solo-jazz':{file:'lesson.png',ratio:'1448 / 1086',description:'photoLessonAlt'},
  'lindy-hop':{file:'lindy-hop.png',ratio:'1536 / 1024',description:'photoParkAlt'},
  workshops:{file:'lesson.png',ratio:'1448 / 1086',description:'photoLessonAlt'},
  social:{file:'social.png',ratio:'1357 / 1159',description:'photoSocialAlt'}
};
export async function CommunityPhoto({name,alt,label,priority=false}:{name:string;alt:string;label:string;priority?:boolean}){
  const photo=photos[name],t=await getTranslations('App');
  const sizes=priority?'(max-width: 600px) 88vw, (max-width: 1280px) 42vw, 540px':name==='workshops'||name==='social'?'(max-width: 800px) 88vw, (max-width: 1280px) 42vw, 540px':'(max-width: 600px) 88vw, (max-width: 800px) 42vw, (max-width: 1280px) 28vw, 360px';
  const base=photo?'/images/community/'+photo.file.replace('.png',''):'';
  return <div className={'community-photo photo-'+name} style={photo?{aspectRatio:photo.ratio}:undefined}>{photo?<img src={base+'-1280.webp'} srcSet={base+'-640.webp 640w, '+base+'-1280.webp 1280w'} sizes={sizes} alt={t(photo.description)} loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} decoding="async" style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>:<div className="photo-placeholder" role="img" aria-label={alt+' — '+label}><span aria-hidden="true">♪</span><small>{label}</small></div>}</div>;
}
