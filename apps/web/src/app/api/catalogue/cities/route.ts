import {apiError} from '../../../../lib/api';
import {allCities} from '../../../../lib/catalogue/data';
import {cityAliases, cityLocale, localizeCities} from '../../../../lib/catalogue/city-name';
import {rankMatches} from '../../../../lib/catalogue/search';
// ?q= matches the local spelling, the en/es/ru names and the slug. ?locale=en|es|ru puts `name` in that language;
// without it `name` stays local, as before localization. `localName` is always the stored spelling.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, locale = cityLocale(params.get('locale')), cities = await allCities();
    const items = rankMatches(locale ? localizeCities(cities, locale) : cities.map(city => ({...city, localName: city.name})), params.get('q') || '', 10, cityAliases);
    return Response.json({items}, {headers: {'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600'}});
  } catch (error) {return apiError(error);}
}
