import {additionalStyles} from '../catalogue-additions';
// The dance-style tree. Slugs are permanent identifiers (they double as ids for seeded rows): never rename one.
// Names are canonical proper names and are not translated. Grouping is product navigation, not a historical taxonomy.
export type StyleRow = readonly [slug: string, name: string, parent: string | null];
// Present since the first releases; kept verbatim so existing databases and links stay valid.
const original: StyleRow[] = [
  ['salsa','Salsa',null],['bachata','Bachata',null],['tango','Tango',null],['kizomba','Kizomba',null],['swing','Swing',null],
  ['lindy-hop','Lindy Hop','swing'],['solo-jazz','Solo Jazz','swing'],['balboa','Balboa','swing'],
  ['collegiate-shag','Collegiate Shag','swing'],['st-louis-shag','St. Louis Shag','swing'],['charleston','Charleston','swing'],
  ['solo-charleston','Solo Charleston','charleston'],['partner-charleston','Partnered Charleston','charleston'],
  ['boogie-woogie','Boogie Woogie','swing'],['bachata-sensual','Bachata sensual','bachata'],['bachata-dominican','Dominican bachata','bachata']
];
// parent slug (or '' for a root) -> children
const families: Record<string, [string, string][]> = {
  '': [
    ['zouk','Zouk'],['forro','Forró'],['brazilian','Brazilian dances'],['afro-cuban','Afro-Cuban'],['merengue','Merengue'],['cumbia','Cumbia'],
    ['latin-urban','Latin urban'],['konpa','Konpa'],['ballroom','Ballroom'],['hustle','Hustle'],['discofox','Discofox'],['fusion','Fusion'],
    ['country','Country & Western'],['folk','Folk & traditional'],['flamenco','Flamenco'],['street-dance','Hip-hop & street dance'],
    ['afro-dance','Afro dance'],['contemporary','Contemporary'],['jazz-dance','Jazz dance'],['ballet','Ballet'],
    ['oriental','Oriental dance'],['indian','Indian dances'],['polynesian','Polynesian dances'],['historical-dance','Historical dance']
  ],
  salsa: [
    ['salsa-cubana','Salsa Cubana (Casino)'],['salsa-la','Salsa LA (On1)'],['salsa-ny','Salsa NY (On2)'],['salsa-cali','Salsa Caleña'],
    ['salsa-puerto-rico','Salsa Puertorriqueña'],['salsa-shines','Salsa Shines'],['salsa-lady-styling','Salsa Lady Styling'],
    ['salsa-choke','Salsa Choke'],['mambo','Mambo'],['pachanga','Pachanga'],['boogaloo','Boogaloo'],['salsaton','Salsatón']
  ],
  'salsa-cubana': [['rueda-de-casino','Rueda de Casino'],['timba','Timba'],['son-cubano','Son Cubano']],
  'afro-cuban': [['rumba-cubana','Rumba Cubana'],['orishas','Orishas'],['reparto','Reparto'],['danzon','Danzón'],['conga','Conga (Comparsa)']],
  'rumba-cubana': [['guaguanco','Guaguancó'],['yambu','Yambú'],['columbia','Columbia']],
  bachata: [
    ['bachata-moderna','Bachata moderna'],['bachata-tradicional','Bachata tradicional'],['bachata-fusion','Bachata fusión'],
    ['bachata-urbana','Bachata urbana'],['bachatango','Bachatango'],['bachazouk','Bachazouk'],
    ['bachata-footwork','Bachata footwork'],['bachata-lady-styling','Bachata Lady Styling']
  ],
  merengue: [['merengue-tipico','Merengue típico']],
  cumbia: [['cumbia-colombiana','Cumbia colombiana'],['cumbia-sonidera','Cumbia sonidera'],['cumbia-texana','Cumbia texana'],['cumbia-villera','Cumbia villera']],
  'latin-urban': [['reggaeton','Reggaetón'],['dembow','Dembow'],['perreo','Perreo']],
  kizomba: [
    ['urban-kiz','Urban Kiz'],['semba','Semba'],['tarraxinha','Tarraxinha'],['tarraxo','Tarraxo'],
    ['kizomba-tradicional','Kizomba tradicional'],['kizomba-fusion','Kizomba fusion'],['douceur','Douceur']
  ],
  zouk: [
    ['brazilian-zouk','Brazilian Zouk'],['lambazouk','Lambazouk'],['neo-zouk','Neo Zouk'],['rio-zouk','Rio Zouk'],['flow-zouk','Flow Zouk'],
    ['soulzouk','Soulzouk'],['mzouk','Mzouk'],['caribbean-zouk','Caribbean Zouk'],['lambada','Lambada']
  ],
  tango: [
    ['tango-salon','Tango de salón'],['tango-milonguero','Tango milonguero'],['tango-nuevo','Tango nuevo'],['tango-vals','Vals (Tango waltz)'],
    ['milonga','Milonga'],['tango-escenario','Tango escenario'],['canyengue','Canyengue'],['tango-orillero','Tango orillero'],
    ['neotango','Neotango'],['queer-tango','Queer Tango'],['candombe','Candombe'],['finnish-tango','Finnish Tango']
  ],
  forro: [
    ['forro-pe-de-serra','Forró pé de serra'],['forro-universitario','Forró universitário'],['forro-roots','Forró roots'],
    ['forro-eletronico','Forró eletrônico'],['xote','Xote'],['baiao','Baião'],['arrasta-pe','Arrasta-pé']
  ],
  brazilian: [
    ['samba-de-gafieira','Samba de gafieira'],['samba-no-pe','Samba no pé'],['pagode','Pagode'],['samba-rock','Samba rock'],
    ['sertanejo','Sertanejo'],['axe','Axé'],['frevo','Frevo'],['carimbo','Carimbó'],['maracatu','Maracatu']
  ],
  swing: [
    ['jitterbug','Jitterbug'],['rock-n-roll','Rock ’n’ Roll'],['rockabilly-jive','Rockabilly Jive'],['modern-jive','Modern Jive'],
    ['hand-dancing','DC Hand Dancing'],['imperial-swing','Imperial Swing'],['push-whip','Push & Whip']
  ],
  'lindy-hop': [['savoy-style-lindy','Savoy-style Lindy Hop'],['hollywood-style-lindy','Hollywood-style Lindy Hop'],['aerials','Aerials (air steps)'],['slow-lindy','Slow Lindy']],
  'solo-jazz': [['shim-sham','Shim Sham'],['big-apple','Big Apple'],['tranky-doo','Tranky Doo']],
  balboa: [['slow-balboa','Slow Balboa']],
  'rock-n-roll': [['acrobatic-rock-n-roll','Acrobatic Rock ’n’ Roll']],
  blues: [
    ['slow-drag','Slow Drag'],['ballroomin-blues','Ballroomin’ Blues'],['juke-joint-blues','Juke Joint Blues'],
    ['solo-blues','Solo Blues'],['struttin','Struttin’'],['chicago-triple','Chicago Triple']
  ],
  tap: [['rhythm-tap','Rhythm Tap'],['broadway-tap','Broadway Tap']],
  fusion: [['blues-fusion','Blues Fusion'],['micro-fusion','Micro Fusion'],['switch-dance','Switch']],
  hustle: [['new-york-hustle','New York Hustle'],['latin-hustle','Latin Hustle'],['disco','Disco']],
  discofox: [['disco-swing','Disco Swing']],
  ballroom: [
    ['ballroom-standard','Ballroom Standard'],['ballroom-latin','Ballroom Latin'],['american-smooth','American Smooth'],
    ['american-rhythm','American Rhythm'],['social-foxtrot','Social Foxtrot'],['nightclub-two-step','Nightclub Two Step'],
    ['sequence-dancing','Sequence dancing'],['new-vogue','New Vogue']
  ],
  'ballroom-standard': [['slow-waltz','Slow Waltz'],['viennese-waltz','Viennese Waltz'],['ballroom-tango','Ballroom Tango'],['slow-foxtrot','Slow Foxtrot'],['quickstep','Quickstep']],
  'ballroom-latin': [['ballroom-samba','Samba (Ballroom)'],['cha-cha-cha','Cha-cha-cha'],['rumba','Rumba (Ballroom)'],['paso-doble','Paso Doble'],['jive','Jive']],
  'american-rhythm': [['bolero','Bolero']],
  country: [
    ['country-two-step','Country Two Step'],['line-dance','Line Dance'],['country-swing','Country Swing'],
    ['square-dance','Square Dance'],['contra-dance','Contra Dance'],['clogging','Clogging']
  ],
  folk: [
    ['balfolk','Balfolk'],['irish-dance','Irish dance'],['scottish-country-dance','Scottish Country Dance'],['ceilidh','Ceilidh'],
    ['english-country-dance','English Country Dance'],['morris','Morris dance'],['israeli-folk-dance','Israeli folk dance'],
    ['balkan-folk','Balkan folk dance'],['greek-folk','Greek folk dance'],['polka','Polka'],['tarantella','Tarantella'],
    ['russian-folk','Russian folk dance'],['hopak','Hopak'],['georgian-dance','Georgian dance'],['lezginka','Lezginka'],['kochari','Kochari'],
    ['spanish-folk','Spanish folk dance'],['folklorico-mexicano','Folklórico mexicano'],['folklore-argentino','Folklore argentino'],
    ['andean','Andean dances'],['joropo','Joropo'],['bambuco','Bambuco']
  ],
  balfolk: [['bourree','Bourrée'],['mazurka','Mazurka'],['schottische','Schottische'],['an-dro','An dro'],['polska','Polska']],
  'irish-dance': [['irish-set-dance','Irish set dance'],['irish-step-dance','Irish step dance'],['ceili','Céilí']],
  'balkan-folk': [['kolo','Kolo'],['horo','Horo']],
  'greek-folk': [['syrtos','Syrtos'],['zeibekiko','Zeibekiko'],['sirtaki','Sirtaki']],
  'russian-folk': [['khorovod','Khorovod'],['kadril','Kadril']],
  'spanish-folk': [['jota','Jota'],['sardana','Sardana'],['muineira','Muiñeira']],
  'folklorico-mexicano': [['jarabe-tapatio','Jarabe tapatío'],['son-jarocho','Son jarocho'],['huapango','Huapango']],
  'folklore-argentino': [['chacarera','Chacarera'],['zamba','Zamba'],['gato','Gato'],['malambo','Malambo']],
  andean: [['huayno','Huayno'],['marinera','Marinera'],['cueca','Cueca']],
  flamenco: [['sevillanas','Sevillanas'],['rumba-flamenca','Rumba flamenca'],['bulerias','Bulerías'],['tangos-flamencos','Tangos flamencos'],['alegrias','Alegrías']],
  'street-dance': [
    ['hip-hop','Hip-hop'],['breaking','Breaking'],['popping','Popping'],['locking','Locking'],['house-dance','House dance'],['krump','Krump'],
    ['waacking','Waacking'],['voguing','Voguing'],['dancehall','Dancehall'],['tutting','Tutting'],['litefeet','Litefeet'],['shuffle','Shuffle'],
    ['electro-dance','Electro dance'],['street-choreography','Choreography'],['k-pop','K-pop cover dance'],['heels','Heels'],['twerk','Twerk']
  ],
  'afro-dance': [
    ['afrobeats','Afrobeats'],['amapiano','Amapiano'],['afro-house','Afro house'],['kuduro','Kuduro'],['azonto','Azonto'],
    ['coupe-decale','Coupé-décalé'],['ndombolo','Ndombolo'],['west-african-dance','West African dance']
  ],
  'west-african-dance': [['sabar','Sabar']],
  contemporary: [['modern-dance','Modern dance'],['contact-improvisation','Contact improvisation'],['ecstatic-dance','Ecstatic dance'],['five-rhythms','5Rhythms']],
  'jazz-dance': [['jazz-funk','Jazz funk'],['lyrical-jazz','Lyrical jazz'],['broadway-jazz','Broadway jazz']],
  ballet: [['classical-ballet','Classical ballet'],['neoclassical-ballet','Neoclassical ballet']],
  oriental: [['raqs-sharqi','Raqs sharqi'],['baladi','Baladi'],['saidi','Saidi'],['tribal-fusion','Tribal fusion'],['dabke','Dabke']],
  indian: [['bollywood','Bollywood'],['bhangra','Bhangra'],['garba','Garba'],['kathak','Kathak'],['bharatanatyam','Bharatanatyam']],
  polynesian: [['hula','Hula'],['ori-tahiti','Ori Tahiti']],
  'historical-dance': [['contredanse','Contredanse'],['vintage-waltz','Vintage waltz'],['regency-dance','Regency dance']]
};
const rows: StyleRow[] = [...original, ...additionalStyles,
  ...Object.entries(families).flatMap(([parent, children]) => children.map(([slug, name]): StyleRow => [slug, name, parent || null]))];
// Parents always precede their children so that a plain in-order upsert satisfies the parent foreign key.
function ordered(input: StyleRow[]): StyleRow[] {
  const bySlug = new Map(input.map(row => [row[0], row])), done = new Set<string>(), out: StyleRow[] = [];
  const visit = (row: StyleRow, trail: string[]) => {
    if (done.has(row[0])) return;
    if (trail.includes(row[0])) throw new Error('Style cycle: ' + [...trail, row[0]].join(' > '));
    if (row[2]) {
      const parent = bySlug.get(row[2]);
      if (!parent) throw new Error('Unknown parent style: ' + row[2]);
      visit(parent, [...trail, row[0]]);
    }
    done.add(row[0]); out.push(row);
  };
  for (const row of input) visit(row, []);
  return out;
}
export const styleTree: readonly StyleRow[] = ordered(rows);
