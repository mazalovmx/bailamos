# Вход через Google, Microsoft и Apple

Реализованы вход, регистрация, подключение/отключение в настройках и вход без пароля со страницы восстановления. Для каждого сервиса кнопки появляются только при наличии полной пары настроек.

## Что это даёт

Пользователь подтверждает личность у выбранного провайдера. Bailamos не получает пароль от Google, Microsoft или Apple. Такой вход необязателен: регистрация по почте, пароль и одноразовые ссылки сохраняются.

Восстановление через провайдера возвращает в существующий аккаунт и открывает настройки. Пароль сайта не восстанавливается из пароля провайдера; при необходимости пользователь задаёт новый пароль по письму. В этом режиме создание нового аккаунта запрещено. Если провайдер не подтверждает адрес или Apple выдаёт скрытый адрес, который отличается от адреса аккаунта, нужно войти прежним способом и подключить сервис в настройках.

## Google

В локальном .env используются CLIENT_ID_GOOGLE и CLIENT_SECRET_GOOGLE. Они поддерживаются наравне с GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET; полной стандартной паре отдаётся предпочтение. Части разных пар не смешиваются.

В Google Auth Platform должен быть создан OAuth-клиент типа Web application. Для локального приложения зарегистрируйте точный Redirect URI:

    http://localhost:3000/api/auth/callback/google

Для публичной версии зарегистрируйте такой же путь на её HTTPS-домене и установите BETTER_AUTH_URL на публичный адрес. Клиент в режиме Testing доступен только добавленным тестовым пользователям. Секрет храните в переменных окружения сервера, никогда не в коде или браузере.

## Microsoft

Нужна регистрация Web application в Microsoft Entra. Для личных и рабочих/учебных учётных записей выберите соответствующий тип поддерживаемых аккаунтов. Callback:

    http://localhost:3000/api/auth/callback/microsoft

Настройки: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET и, при необходимости, MICROSOFT_TENANT_ID (по умолчанию common). Поддерживаются также CLIENT_ID_MICROSOFT и CLIENT_SECRET_MICROSOFT как полная пара. Используйте значение client secret, а не его identifier. Не отключайте проверку подтверждения почты для автоматической привязки существующего аккаунта.

## Apple

Нужны активный Apple Developer account, App ID с Sign in with Apple, связанный Services ID и ключ .p8. Apple web-вход требует публичный HTTPS-домен; localhost не подходит. Return URL:

    https://<домен>/api/auth/callback/apple

Настройки: APPLE_CLIENT_ID (Services ID), APPLE_TEAM_ID, APPLE_KEY_ID и APPLE_PRIVATE_KEY (содержимое .p8; допустимы переводы строк, записанные как \n). Сервер подписывает ES256 client-secret JWT на один час при каждом получении настроек провайдера; готовый истекающий JWT вручную не требуется. Origin appleid.apple.com разрешён для POST callback. При использовании Hide My Email повторный вход должен использовать ту же Apple identity.

## Проверка и ограничения

OAuth-тесты используют временные локальные ключи и проверяют адреса авторизации, серверное состояние восстановления, криптографическую подпись Apple, запрет отключения без пароля, Origin и чужие аккаунты. Они не доказывают успешный вход в реальных кабинетах провайдеров. Настоящий проход от входа у провайдера до возврата и создания сессии требует настроенного приложения и участия владельца учётной записи.

Источники: [Google OAuth для web-приложений](https://developers.google.com/identity/protocols/oauth2/web-server), [Microsoft в Better Auth](https://better-auth.com/docs/authentication/microsoft), [Apple в Better Auth](https://better-auth.com/docs/authentication/apple), [привязка аккаунтов](https://better-auth.com/docs/concepts/users-accounts).

## Текущее подключение

11 октября: CLIENT_ID_GOOGLE и CLIENT_SECRET_GOOGLE подхвачены. После исправления callback Google открывает страницу «Sign in to continue to Bailamos» без redirect_uri_mismatch. Полный вход владельцем и создание реальной сессии ещё не проверены. Для production добавить https://bailamos.me/api/auth/callback/google. Microsoft и Apple в локальном .env пока не настроены. Все 54 браузерные проверки кнопок трёх провайдеров на en/ru/es, desktop/mobile прошли с тестовыми ответами OAuth; это не проверка реальных кабинетов Microsoft/Apple.
