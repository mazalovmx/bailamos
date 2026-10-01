// Coordinates represent approximate city centres, never event venues.
export const additionalCities = [
  {id:'barcelona',name:'Barcelona',countryCode:'ES',timezone:'Europe/Madrid',lat:41.3874,lng:2.1686},
  {id:'valencia',name:'Valencia',countryCode:'ES',timezone:'Europe/Madrid',lat:39.4699,lng:-.3763},
  {id:'seville',name:'Sevilla',countryCode:'ES',timezone:'Europe/Madrid',lat:37.3891,lng:-5.9845},
  {id:'guadalajara',name:'Guadalajara',countryCode:'MX',timezone:'America/Mexico_City',lat:20.6597,lng:-103.3496},
  {id:'monterrey',name:'Monterrey',countryCode:'MX',timezone:'America/Monterrey',lat:25.6866,lng:-100.3161},
  {id:'saint-petersburg',name:'Санкт-Петербург',countryCode:'RU',timezone:'Europe/Moscow',lat:59.9343,lng:30.3351},
  {id:'kazan',name:'Казань',countryCode:'RU',timezone:'Europe/Moscow',lat:55.7961,lng:49.1064},
  {id:'berlin',name:'Berlin',countryCode:'DE',timezone:'Europe/Berlin',lat:52.52,lng:13.405},
  {id:'paris',name:'Paris',countryCode:'FR',timezone:'Europe/Paris',lat:48.8566,lng:2.3522},
  {id:'london',name:'London',countryCode:'GB',timezone:'Europe/London',lat:51.5074,lng:-.1278},
  {id:'lisbon',name:'Lisboa',countryCode:'PT',timezone:'Europe/Lisbon',lat:38.7223,lng:-9.1393},
  {id:'stockholm',name:'Stockholm',countryCode:'SE',timezone:'Europe/Stockholm',lat:59.3293,lng:18.0686},
  {id:'new-york',name:'New York',countryCode:'US',timezone:'America/New_York',lat:40.7128,lng:-74.006},
  {id:'buenos-aires',name:'Buenos Aires',countryCode:'AR',timezone:'America/Argentina/Buenos_Aires',lat:-34.6037,lng:-58.3816},
  {id:'bogota',name:'Bogotá',countryCode:'CO',timezone:'America/Bogota',lat:4.711,lng:-74.0721}
] as const;
export const additionalStyles = [
  ['pure-balboa','Pure Balboa','balboa'],
  ['bal-swing','Bal-Swing','balboa'],
  ['carolina-shag','Carolina Shag','swing'],
  ['west-coast-swing','West Coast Swing','swing'],
  ['east-coast-swing','East Coast Swing','swing'],
  ['blues','Blues',null],
  ['tap','Tap',null]
] as const;
