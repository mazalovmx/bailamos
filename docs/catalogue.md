# Города и направления

Каталог расширен с 3 до 18 городов и с 16 до 23 направлений. Данные добавляются идемпотентным `pnpm db:seed`: существующие записи пользователя не перезаписываются. Это доступные места для публикации, а не обещание наличия событий в каждом городе.

Добавлены Barcelona, Valencia, Sevilla, Guadalajara, Monterrey, Санкт-Петербург, Казань, Berlin, Paris, London, Lisboa, Stockholm, New York, Buenos Aires, Bogotá. Координаты обозначают приблизительные центры городов, не площадки событий. Для каждого города задан идентификатор часового пояса IANA; его поддержка проверяется тестом и перед загрузкой записи. [О базе часовых поясов IANA](https://www.iana.org/time-zones).

Новые направления: Pure Balboa и Bal-Swing (внутри Balboa), Carolina Shag, West Coast Swing, East Coast Swing, Blues, Tap. Blues и Tap — самостоятельные соседние направления, не подстили Lindy Hop. Выбор Balboa в поиске включает оба новых подстиля; выбор Swing включает все его дочерние направления.

Ориентиры для названий: [Herräng — программы Balboa, Solo Jazz и Tap](https://www.herrang.com/2026/courses), [Brisbane Balboa Swing — Pure Balboa и Bal-Swing](https://brisbanebalboaswing.dance/), [World Swing Dance Council — West Coast Swing](https://worldsdc.com/about/), [Association of Carolina Shag Clubs](https://shagdance.com/acscpage.htm). Группировка в каталоге — продуктовая навигация, не исчерпывающая историческая классификация.

В фильтрах с более чем 10 вариантами доступен поиск внутри списка. Он не очищает выбранные значения и не отправляется как глобальный поиск событий. «Выбрать найденные» добавляет совпавшие варианты к текущему выбору. Скрытые поиском выбранные чекбоксы остаются частью запроса. Символы с диакритикой, например Bogotá, можно искать без неё: Bogota.
