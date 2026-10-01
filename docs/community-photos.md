# Фотографии для главной страницы

На главной установлены изображения, предоставленные пользователем в папке `images/`. Оригиналы сохранены без изменений. Публичные копии находятся в `apps/web/public/images/community/`; соответствие разделам задано в `apps/web/src/components/community-photo.tsx`. Next Image выдаёт адаптивные версии для экрана, первый кадр загружается приоритетно, остальные — лениво. Контейнеры сохраняют исходные пропорции фотографий на телефоне и компьютере.

| Раздел | Исходник в images | Публичная копия |
| --- | --- | --- |
| Первый экран | 1950s Swing Dance Hall Jubilee.png | hero.png |
| Регулярные занятия | Midcentury Swing Dance Hall.png | classes.png |
| Соло-джаз и воркшопы | Vintage Swing Dance Lesson.png | lesson.png |
| Линди-хоп | Swing Dance in the Park.png | lindy-hop.png |
| Вечеринки | Swing Night at the Jazz Club.png | social.png |

Урок используется в двух разделах, поскольку на нём показана демонстрация сольного шага группе. Дубликат `Vintage Swing Dance Lesson (1).png` и остальные варианты оставлены в исходной папке. Описания изображений для экранных дикторов переведены на три языка. Для замены кадра обновите публичный файл и его пропорции/описание в компоненте; затем пересоберите сайт.

Ниже сохранены первоначальные промпты для будущих вариантов фотографий. Имена JPG из этой таблицы — предложения для генерации, а не действующее автоматическое сопоставление файлов.

Общий стиль для всех промптов: realistic editorial dance photography, contemporary welcoming swing community, diverse adult dancers, warm natural light, subtle film grain, sage green and warm cream palette, natural candid expressions, anatomically correct hands and feet, authentic grounded swing dance posture, no acrobatics, no text, no logos, no watermark. These are illustrative community images, not photos of an advertised real event.

| Имя файла | Размер | Сюжет — добавьте к общему промпту |
| --- | --- | --- |
| hero.jpg | 1600 × 2000 | A joyful adult couple dancing Lindy Hop in an airy wooden-floor dance hall, full bodies visible, relaxed bent knees, clear partner connection, a few softly blurred dancers behind them, main couple centered with generous space around them. |
| classes.jpg | 1600 × 1200 | A small friendly weekly beginner swing class, an adult teacher explaining a simple step to a semicircle of adult students, full bodies, bright neighbourhood studio, candid learning moment. |
| solo-jazz.jpg | 1600 × 1200 | An adult solo jazz dancer improvising rhythmic footwork, relaxed knees and playful expression, full body and feet visible, wooden floor, two people practising separately in the background. |
| lindy-hop.jpg | 1600 × 1200 | Two adult Lindy Hop dancers in open position holding one hand, natural counterbalance, joyful eye contact, full bodies visible, casual contemporary clothes, no ballroom hold or lifts. |
| workshops.jpg | 1800 × 1100 | An adult swing teacher demonstrating footwork during a focused workshop, small group of attentive adult participants, inclusive modern studio, full bodies, documentary composition. |
| social.jpg | 1800 × 1100 | A warm evening swing social with several adult couples dancing, small jazz band softly visible behind them, amber lighting, inviting community atmosphere, no staged crowd facing camera. |

Для первых результатов достаточно `hero.jpg`, `solo-jazz.jpg` и `social.jpg`. Не добавляйте текст в изображения — заголовки переводятся на сайте. Для мобильного кадрирования оставьте около 15% свободного пространства по краям. Перед использованием проверьте анатомию и правдоподобие танцевальных поз.

# Экспорт объявлений

В редакторе есть быстрые переходы «Редактировать объявление» / «Предпросмотр и сохранение». На телефоне они закреплены сверху. После загрузки фото ползунок «Положение фото» позволяет изменить вертикальное кадрирование; размер и положение проверяются прямо в предпросмотре. Пустые поля не резервируют отдельные области на изображении.

`/en/share`, `/ru/share`, `/es/share` — редактор произвольного объявления. На опубликованном событии есть раздел «Поделиться событием» с выбранной датой и ссылкой в подписи. Фотография загружается только в браузер, не отправляется на сервер. Результат: PNG 1080×1350, 1080×1920 или 1080×1080. Формат выбирается один, поскольку это размер одного экспортируемого файла.

Кнопка «Поделиться изображением» открывает системное меню только по действию пользователя. Наличие Instagram/WhatsApp в нём зависит от устройства и установленных приложений. Запасной способ: сохранить PNG, прикрепить вручную и скопировать подпись. Автопубликации и подключения аккаунтов нет. Возможности Web Share проверяются через `navigator.canShare`, см. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share). Для размещённого сайта нужен HTTPS. Изображение не содержит активной ссылки; ссылка копируется отдельно в подписи.

Фильтры каталога допускают несколько городов, направлений, типов, уровней, форматов, интенсивностей, темпов и тегов. Внутри группы — любой вариант (OR), между группами — совместное условие (AND). Повторяющиеся URL-параметры сохраняются при пагинации и переключении языка. В формах создания события поля с единственным значением (например, город проведения) остаются одиночными.

Каждая группа фильтров содержит кнопки «Выбрать всё» и «Очистить выбор». Изменения вступают в силу после применения фильтров. На мобильном кнопки применения и полного сброса закрепляются у нижнего края области фильтров при прокрутке.
