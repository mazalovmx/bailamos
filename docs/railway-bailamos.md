# Выпуск bailamos.me на Railway

Обновлено 11 октября 2026. Локальный каталог связан с Railway проектом `cozy-acceptance` (fa5444f5-b173-48a3-9a24-d80e720f5f5a), environment `production`, service `bailamos`. Существующая версия из `stable` восстановлена: HTTPS, главная en/ru/es, login/register и `/api/health/ready` возвращают HTTP 200; database/redis имеют статус ok. PostGIS, Redis и bucket созданы; worker/admin ещё не запущены. Новые локальные изменения ещё не опубликованы. Перевыпуск применил секрет Better Auth и PORT=3000: прежний контейнер слушал 8080 и использовал стандартный секрет, из-за чего домен возвращал 502. Все 15 миграций применены; загружены 97 городов, 291 стиль и тематические теги. Рабочая ветка `fix/ux-audit`; выпуск идёт через `experiments → stable → deploy`. Не включать в релиз посторонние изменения файла технических требований и временные скриншоты.

Домен `bailamos.me` добавлен к Railway с target port 3000. В Cloudflare Free сохранены CNAME корня `ttnf6tf4.up.railway.app` (DNS only) и TXT `_railway-verify` со значением, выданным Railway. GoDaddy принял смену NS на `dante.ns.cloudflare.com` и `ingrid.ns.cloudflare.com`; публичный резолвер 1.1.1.1 уже возвращает новые NS. Railway подтверждает `verified=true`, `syncStatus=ACTIVE`, сертификат `VALID`, подробный статус `COMPLETE`. HTTPS и readiness проверены без обхода TLS.

Пользователь согласовал бюджет $10 в месяц без смены Hobby. Для workspace установлен compute hard limit $10 и уведомление $5; лимит относится также к другому проекту `poetic-warmth`. Railway останавливает workloads при достижении лимита. Минимальный поддерживаемый hard limit равен $10, поэтому исходный строгий лимит $5 был пересогласован. Railway Agent не используется для выпуска.

Созданы PostGIS (`postgis/postgis:17-3.5`, постоянный volume `/var/lib/postgresql/data`, RAM 256 МБ/CPU 0.25), Redis (RAM 128 МБ/CPU 0.25) и приватный S3 bucket `bailamos-media` в sjc. Postgres запущен и принимает подключения. Web ограничен RAM 512 МБ/CPU 0.5, включён сон при отсутствии запросов. DB/Redis/S3 и Google credentials перенесены в web; секреты не включаются в исходники. Эти пределы требуют проверки на реальной нагрузке; они не означают фиксированной стоимости сервисов.

SMTP пока отсутствует: локальный `.env` содержит только Mailpit. Доставка verification/reset и production preflight требуют настоящего почтового провайдера. GitHub MCP читает репозиторий, но запись tree отклонена с 403 Resource not accessible by integration. Обычный `git push` также не прошёл: User cancelled dialog и недоступный канал авторизации VS Code. Владелец завершил Git Credential Manager login; обычный git push ветки fix/ux-audit выполнен успешно.

Проверено: `SELECT PostGIS_Version()` на Railway возвращает 3.5; через драйвер приложения выполнены запись/чтение/удаление временного объекта S3, CORS разрешает PUT с `https://bailamos.me`. Production preflight web сообщает только недостающие SMTP-параметры. Локальный полный `pnpm test` прошёл 251 проверку (237 web, 9 admin, 5 общих), без ошибок и пропусков. Это не заменяет production login, mail, upload и worker acceptance после публикации.

Старой версии `stable` добавлены совместимые `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` вместе с новыми именами. Для следующего deployment настроены явные build/start, миграции до запуска и healthcheck readiness. Deployment с совместимыми именами завершён SUCCESS. Google production endpoint возвращает HTTP 200 и URL accounts.google.com, владелец добавил `https://bailamos.me/api/auth/callback/google`; свежий запрос открывает страницу Google без redirect_uri_mismatch и invalid_client. Успешный вход владельца ещё не проверен. Microsoft/Apple credentials и SMTP отсутствуют.

## Сервисы

Все три приложения подключаются к `mazalovmx/bailamos`, ветка `deploy`, корень `/`, Wait for CI включён.

| Сервис | Railway config | Домен | Назначение |
| --- | --- | --- | --- |
| web | `/railway.json` | `bailamos.me` | Сайт, миграции и справочники |
| admin | `/railway.admin.json` | `admin.bailamos.me` | Панель сотрудников |
| worker | `/railway.worker.json` | Не нужен | Очереди, письма, обслуживание медиа |
| Postgres | PostgreSQL 17 с PostGIS 3.5 | Только private network | Данные, постоянный volume, резервные копии |
| Redis | Railway Redis | Только private network | Очереди и кеш |

Обычный PostgreSQL без PostGIS не подходит. Для image-сервиса использовать `postgis/postgis:17-3.5`, volume `/var/lib/postgresql/data`, задать POSTGRES_USER/PASSWORD/DB и private DATABASE_URL. Это отдельная настройка инфраструктуры, JSON приложений её не создаёт. Пароль должен быть случайным; спецсимволы в URL кодируются. Перед миграциями проверить `SELECT PostGIS_Version();`, либо наличие extension-файлов и возможность `CREATE EXTENSION postgis`.

## Переменные и хранилище

Шаблон: [deploy/railway.variables.example](../deploy/railway.variables.example). `${{Postgres.DATABASE_URL}}` и `${{Redis.REDIS_URL}}` работают только при точных именах сервисов и наличии соответствующих variables; у image PostGIS значение DATABASE_URL нужно создать явно.

Web и worker используют одинаковые DB, Redis, auth secret, SMTP и S3. Admin нужны DB, auth secret, ADMIN_URL, WEB_URL и Railpack settings. Не переносить локальную `.env` целиком: localhost, Mailpit и локальный пароль непригодны. Секреты хранить в Railway Variables. Сгенерировать независимые production BETTER_AUTH_SECRET и MEDIA_SIGNING_SECRET, например `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.

Настроить отдельный S3-compatible bucket (например уже имеющееся хранилище): web и worker не могут совместно читать один Railway volume. Для AWS S3 удалить S3_ENDPOINT и поставить S3_FORCE_PATH_STYLE=false, указать фактический регион. Для другого провайдера использовать его endpoint/region. Разрешить browser upload CORS для `https://bailamos.me`: PUT, GET, HEAD; заголовки Content-Type и заголовки подписи провайдера. Проверить загрузку, чтение после перезапуска и удаление worker. Не публиковать ключи в NEXT_PUBLIC variables.

SMTP должен доставлять verification и reset письма. Добавить рекомендованные провайдером SPF, DKIM, DMARC для bailamos.me; SMTP_SECURE=true для 465, false для STARTTLS на 587. Проверить доставку на внешний адрес. Локальные аккаунты и медиа автоматически в production не переносятся.

Для небольшого старта подготовлен [SMTP пример Resend](../deploy/smtp.resend.env.example). [Free](https://resend.com/pricing) даёт 3000 писем в месяц, максимум 100 в день; платный тариф не подключать. По [официальной инструкции](https://resend.com/docs/send-with-smtp): smtp.resend.com, 465/TLS, пользователь resend, пароль — API key. Владелец создаёт аккаунт/ключ и подтверждает домен; ключ не отправлять в чат и не коммитить. После добавления SMTP в локальную .env перенести значения в web/worker и проверить настоящее письмо.

`www.bailamos.me` добавлен к web с портом 3000. В Cloudflare сохранены CNAME www → l2ck69gk.up.railway.app (DNS only) и TXT _railway-verify.www. DNS записи опубликованы; отдельный сертификат и перенаправление на основной домен ещё требуют проверки.

## Домены и OAuth

В Railway web → Settings → Networking добавить `bailamos.me`; admin — `admin.bailamos.me`. Перенести точные routing и verification DNS-записи из Railway в панель регистратора. Для apex нужен ALIAS/ANAME или CNAME flattening; статический IP Railway не придумывать. SSL выдаётся Railway после проверки. `www.bailamos.me` добавлять только с отдельно настроенным перенаправлением на основной домен.

| Провайдер | Production redirect / return URL |
| --- | --- |
| Google | `https://bailamos.me/api/auth/callback/google` |
| Microsoft | `https://bailamos.me/api/auth/callback/microsoft` |
| Apple | `https://bailamos.me/api/auth/callback/apple` |

Google: добавить production URI к существующему OAuth Web Client, сохранить localhost callback для разработки; authorized domain `bailamos.me`, homepage `https://bailamos.me`, privacy `https://bailamos.me/en/privacy`. Отдельной страницы terms в проекте пока нет: не указывать несуществующий адрес. Проверить фактические страницы перед отправкой на verification и перевести приложение из Testing для публичного доступа, когда требования Google выполнены. Локальная проверка уже открывает Google Sign in to continue to Bailamos без redirect_uri_mismatch; полный вход владельцем ещё не проверен.

Microsoft и Apple реализованы, но реальные ключи отсутствуют. Их регистрация описана в [social-sign-in.md](social-sign-in.md). Для Apple зарегистрировать домен bailamos.me и Return URL в Services ID; ключ P-256 хранить только на сервере. Восстановление через провайдера открывает существующий аккаунт, затем можно установить пароль через подтверждённую почту; это не сброс пароля самого Google/Microsoft/Apple.

## Порядок выпуска и проверка

1. Завершить review изменений и CI, последовательно продвинуть в deploy; не force-push.
2. Создать PostGIS, Redis и bucket, настроить переменные и backup. Сначала подготовить web; worker/admin запустить после успешных миграций web.
3. Web pre-deploy проверяет variables, выполняет `prisma migrate deploy` и idempotent seed. Не применять reset/db push к production. Сервисы получают PORT от Railway, bind `0.0.0.0`.
4. Прикрепить домены, дождаться DNS/SSL, зарегистрировать OAuth callbacks.
5. Проверить `/api/health/ready` (DB/Redis) и `/api/health/worker` (heartbeat), страницы en/ru/es на телефоне и desktop.
6. Пройти регистрацию, verification, email reset, Google login и повторный вход, onboarding, загрузку фото, создание/просмотр события. Проверить ошибку и отказ OAuth. Microsoft/Apple проверить после предоставления ключей.
7. Выдать первому владельцу роль штатным grant-role скриптом по [status.md](status.md), проверить admin и отказ обычному пользователю. Не создавать общий пароль администратора.
8. Настроить внешнее наблюдение readiness/worker и резервные копии; провести пробное восстановление по [operations.md](operations.md). При rollback кода не откатывать миграции автоматически.

Перед выпуском доступны `node scripts/check-production-env.mjs web|worker|admin` в окружении Railway. Проверка не печатает секреты и не подтверждает доступность внешних сервисов. Web deployment healthcheck теперь использует readiness; ошибки DB/Redis блокируют успешный rollout.

Источники: [Railway DNS и SSL](https://docs.railway.com/networking/domains/working-with-domains), [Railpack Node settings](https://railpack.com/languages/node/), [deployment config](https://docs.railway.com/config-as-code/reference).

## Временный запуск без почтового входа

Пока SMTP отсутствует, для web явно установить EMAIL_AUTH_ENABLED=false. Формы почтового входа/регистрации/восстановления скрыты с понятным сообщением на en/es/ru; соответствующие серверные маршруты отклоняются с EMAIL_AUTH_UNAVAILABLE. Social OAuth остаётся доступным. Это не подтверждает готовность почты: worker по-прежнему требует настоящего SMTP. После подключения и проверки SMTP установить EMAIL_AUTH_ENABLED=true в web и перевыпустить приложение. По умолчанию почтовый вход включён, поэтому неполная конфигурация SMTP блокирует обычный production preflight.
