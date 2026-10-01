import {getTranslations} from 'next-intl/server';
// Each section has its own photograph. The frame's proportions come from the stylesheet, not from the source file,
// so a tall original cannot stretch the page; the image is cropped to fill the frame.
const photos:Record<string,{file:string;description:string}>={
  hero:{file:'hero.png',description:'photoHeroAlt'},
  classes:{file:'classes.png',description:'photoClassesAlt'},
  'solo-jazz':{file:'solo-jazz.png',description:'photoSoloAlt'},
  'lindy-hop':{file:'lindy-hop.png',description:'photoParkAlt'},
  workshops:{file:'lesson.png',description:'photoLessonAlt'},
  social:{file:'social.png',description:'photoSocialAlt'}
};
export async function CommunityPhoto({name,alt,label,priority=false}:{name:string;alt:string;label:string;priority?:boolean}){
  const photo=photos[name],t=await getTranslations('App');
  const sizes=priority?'(max-width: 600px) 88vw, (max-width: 1280px) 42vw, 540px':name==='workshops'||name==='social'?'(max-width: 800px) 88vw, (max-width: 1280px) 42vw, 540px':'(max-width: 600px) 88vw, (max-width: 800px) 42vw, (max-width: 1280px) 28vw, 360px';
  const base=photo?'/images/community/'+photo.file.replace('.png',''):'';
  return <div className={'community-photo photo-'+name}>{photo?<img src={base+'-1280.webp'} srcSet={base+'-640.webp 640w, '+base+'-1280.webp 1280w'} sizes={sizes} alt={t(photo.description)} loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} decoding="async" style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>:<div className="photo-placeholder" role="img" aria-label={alt+' — '+label}><span aria-hidden="true">♪</span><small>{label}</small></div>}</div>;
}
