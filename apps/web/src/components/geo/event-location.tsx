'use client';
import {useEffect,useRef,useState} from 'react';
import {useTranslations} from 'next-intl';
import type {Map as MapType,Marker} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {VenuePicker} from './venue-picker';
import {brand,loadMapLibre,mapLocale,mapStyleUrl,tint} from './maplibre';
import '../../app/styles/geo.css';
type City = {id: string; name: string; lat?: number; lng?: number};
type Point = {lat:number;lng:number};
// Where an event takes place: one of the city's venues, or an exact point of its own (a park, a square) when there is none.
// Submits "venueId" and "pin" (JSON {lat,lng} or empty); the server accepts one or the other, never both.
export function EventLocation({city, initial}: {city?: City; initial: Record<string, string>}) {
  const t = useTranslations('Geo');
  const startLat = Number(initial.lat), startLng = Number(initial.lng);
  // An event saved without a venue away from the city centre was placed by hand.
  const placed = !initial.venueId && !!initial.lat && !!initial.lng && Number.isFinite(startLat) && Number.isFinite(startLng)
    && !!city && (startLat !== city.lat || startLng !== city.lng);
  const [custom, setCustom] = useState(placed);
  const [lat, setLat] = useState(placed ? String(startLat) : '');
  const [lng, setLng] = useState(placed ? String(startLng) : '');
  const point = {lat: Number(lat), lng: Number(lng)};
  const valid = lat !== '' && lng !== '' && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
  const updatePin = (next:Point) => {
    const clean={lat:Number(Math.max(-90,Math.min(90,next.lat)).toFixed(6)),lng:Number(Math.max(-180,Math.min(180,next.lng)).toFixed(6))};
    setLat(String(clean.lat));setLng(String(clean.lng));
  };
  return <fieldset className="geo-event-location"><legend>{t('eventLocation')}</legend>
    {custom ? <input type="hidden" name="venueId" value=""/> : <VenuePicker name="venueId" cityId={city?.id || ''} initialVenueId={initial.venueId}/>}
    <input type="hidden" name="pin" value={custom && valid ? JSON.stringify(point) : ''}/>
    <label className="checkbox"><input type="checkbox" checked={custom} disabled={!city} onChange={event => setCustom(event.target.checked)}/>{t('pinToggle')}</label>
    {custom && <>
      <div className="form-grid">
        <label>{t('latitude')}<input type="number" inputMode="decimal" step="any" min={-90} max={90} required value={lat} onChange={event => setLat(event.target.value)}/></label>
        <label>{t('longitude')}<input type="number" inputMode="decimal" step="any" min={-180} max={180} required value={lng} onChange={event => setLng(event.target.value)}/></label>
      </div>
      <p className="field-note">{t('pinHint')}</p>
      {city&&<EventPinMap key={city.id} city={city} point={valid?point:null} onPick={updatePin}/>}
      {!valid&&<p className="field-note" role="status">{t('pinRequired')}</p>}
    </>}
  </fieldset>;
}

function EventPinMap({city,point,onPick}:{city:City;point:Point|null;onPick:(point:Point)=>void}){
  const t=useTranslations('Geo'),box=useRef<HTMLDivElement>(null),map=useRef<MapType|null>(null),marker=useRef<Marker|null>(null),pick=useRef(onPick);
  const [failed,setFailed]=useState(false);pick.current=onPick;
  useEffect(()=>{
    let cancelled=false;
    loadMapLibre().then(lib=>{
      if(cancelled||!box.current)return;
      const start=point??{lat:city.lat??0,lng:city.lng??0};
      const instance=new lib.Map({container:box.current,style:mapStyleUrl,center:[start.lng,start.lat],zoom:point?15:12,cooperativeGestures:true,locale:mapLocale(t)});
      map.current=instance;instance.addControl(new lib.NavigationControl({showCompass:false}),'top-right');
      instance.on('style.load',()=>{tint(instance);setFailed(false);});instance.on('error',()=>setFailed(true));
      instance.on('click',event=>pick.current({lat:event.lngLat.lat,lng:event.lngLat.lng}));
      const pin=new lib.Marker({color:brand.dark,draggable:true});marker.current=pin;
      pin.on('dragend',()=>{const at=pin.getLngLat();pick.current({lat:at.lat,lng:at.lng});});
      const element=pin.getElement();element.tabIndex=0;element.setAttribute('aria-label',t('pinKeyboard'));
      element.addEventListener('keydown',event=>{
        const step=event.shiftKey?0.001:0.0001,delta=({ArrowUp:[step,0],ArrowDown:[-step,0],ArrowLeft:[0,-step],ArrowRight:[0,step]} as Record<string,number[]>)[event.key];
        if(!delta)return;event.preventDefault();event.stopPropagation();const at=pin.getLngLat();pick.current({lat:at.lat+delta[0],lng:at.lng+delta[1]});
      });
      if(point)pin.setLngLat([point.lng,point.lat]).addTo(instance);
    }).catch(()=>{if(!cancelled)setFailed(true);});
    return()=>{cancelled=true;map.current?.remove();map.current=null;marker.current=null;};
  },[city.id]);
  useEffect(()=>{
    if(!map.current||!marker.current)return;
    if(point){marker.current.setLngLat([point.lng,point.lat]).addTo(map.current);map.current.easeTo({center:[point.lng,point.lat],zoom:Math.max(map.current.getZoom(),15)});}
    else marker.current.remove();
  },[point?.lat,point?.lng]);
  return <><p className="field-note">{t('pinMapHelp')}</p><div className="geo-map small" ref={box} role="region" aria-label={t('eventMap')}/>
    {failed&&<p className="field-note" role="status">{t('pinMapUnavailable')}</p>}</>;
}
