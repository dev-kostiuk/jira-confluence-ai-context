# jira-context (документація українською)

**jira-context** копіює задачі з **Jira** і сторінки з **Confluence** у звичайні файли в каталозі `output/`. Мета — дати асистентам з кодом (або вам) **швидкий, зручний для пошуку та grep контекст** з **Atlassian Cloud** або **власного Jira / Confluence (Data Center чи Server)** — у тому числі з **різними піддоменами** (wiki / jira) і з **різними префіксами REST** (`/wiki/rest/api` та `/rest/api`).

У репозиторії є **дві незалежні реалізації** з **однаковими змінними середовища** та **однаковою структурою виводу**:

| Середовище | Каталог | Типова команда |
|------------|---------|------------------|
| **Python** | `app/` | `python -m app` |
| **Node.js** | `node/src/` | `node node/src/cli.js` або `npm run sync` з `node/` |

Можна користуватись лише однією; обидві не обов’язкові.

Англомовна версія цього ж матеріалу: [README.md](README.md).

---

## Зміст

1. [Що саме синхронізується](#що-саме-синхронізується)
2. [Структура репозиторію](#структура-репозиторію)
3. [Вимоги](#вимоги)
4. [Автентифікація](#автентифікація)
5. [Конфігурація](#конфігурація)
6. [Запуск (Python)](#запуск-python)
7. [Запуск (Node.js)](#запуск-nodejs)
8. [Куди пишуться файли](#куди-пишуться-файли)
9. [Як працює пошук у Jira](#як-працює-пошук-у-jira)
10. [Як працює експорт Confluence](#як-працює-експорт-confluence)
11. [Обмеження](#обмеження)
12. [Типові проблеми](#типові-проблеми)
13. [Безпека](#безпека)
14. [Посилання](#посилання)

---

## Що саме синхронізується

### Jira

Підтягуються задачі, якщо збігається **хоча б одна** з умов (усі умови з’єднуються через `OR`, далі ключі задач **дедуплікуються**):

- `assignee = currentUser()` — ви виконавець  
- `reporter = currentUser()` — ви автор (reporter)  
- `watcher = currentUser()` — лише для **Jira REST API v3** (типово Cloud); на **v2 / більшість DC** не додається  
- `participant in (currentUser())` — те саме (орієнтир на Cloud)  
- **API v3 (Cloud):** додатково всі **searchable** поля з `GET …/rest/api/3/field` типу один користувач або мульти-вибір користувачів (кастомні поля через `cf[…]` де можливо)  
- **API v2 (типовий DC):** лише **`assignee`** і **`reporter`** — щоб уникнути `400` на довгому OR із полів, які на DC фактично не шукаються в JQL. Розширення — через **`EXTRA_JQL`** або **`USE_RAW_JQL_ONLY` + `RAW_JQL`**

Опційно `EXTRA_JQL` додається через `OR`. Якщо підсумковий JQL **занадто довгий**, він **розбивається на кілька запитів**; повтори за одним і тим самим ключем задачі відкидаються.

Для кожної задачі створюються:

- `KEY.md` — зручний для людини заголовок + повний дамп полів у JSON (зручно для ШІ)  
- `KEY.json` — сирий JSON задачі з API пошуку  

Заголовки в Markdown (розділи на кшталт Description, All fields) **англійською**, щоб файли та структура були передбачуваними для інструментів.

### Confluence

Для кожного простору (або **усіх**, до яких є доступ, або списку з `CONFLUENCE_SPACE_KEYS`) експортуються **віків-сторінки** (`type=page`):

- `slug-назви.md` — HTML формату storage перетворюється на Markdown  
- `slug-назви.json` — сирий JSON сторінки  

Якщо пошук не повернув `body.storage`, виконується додатковий запит `GET …/content/{id}?expand=body.storage`.

---

## Структура репозиторію

```
.
├── .env.example          # Шаблон: скопіюйте в `.env` у корені репо
├── README.md             # Документація англійською
├── README.uk.md          # Цей файл
├── app/                  # Python
│   ├── __main__.py
│   ├── cli.py
│   ├── config.py
│   ├── http_util.py
│   ├── adf_text.py
│   ├── jira_sync.py
│   ├── jql_builder.py
│   └── confluence_sync.py
├── node/                 # Node.js
│   ├── package.json
│   └── src/
│       ├── cli.js
│       ├── config.js
│       ├── http.js
│       ├── adfToPlain.js
│       ├── jira/
│       └── confluence/
├── pyproject.toml
├── requirements.txt
└── output/               # Створюється під час роботи (у .gitignore)
```

---

## Вимоги

- **Jira** (для синку задач) і за бажанням **Confluence**, на **Atlassian Cloud** (`*.atlassian.net`) або на **власному Data Center / Server**  
- Обліковий запис з правами на потрібні задачі та простори; на DC часто **логін + пароль або PAT**, а не хмарний API token  
- **Python 3.10+** або **Node.js 18+** (`fetch` + пакет **`undici`** для `HTTPX_VERIFY_SSL=0`)

---

## Автентифікація

Обидва CLI надсилають **HTTP Basic** (`Authorization: Basic …`) на кожен запит.

- **Cloud:** [API token](https://id.atlassian.com/manage-profile/security/api-tokens), username — **email** Atlassian, пароль — **токен** (не веб-пароль).  
- **Data Center / Server:** зазвичай **ім’я користувача Jira** (не завжди email) і **пароль або PAT**, який дозволяє REST. Токени з `id.atlassian.com` для DC **часто не підходять**.

Якщо Jira і Confluence на **різних URL**, задайте **`JIRA_SITE`** (Jira) і **`ATLASSIAN_SITE`** (Confluence).

---

## Конфігурація

Скопіюйте `.env.example` у файл **`.env` у корені репозиторію** (рекомендовано — тоді зручно і Python, і Node).

| Змінна | Обов’язкова | Опис |
|--------|-------------|------|
| `ATLASSIAN_SITE` | **Так** | Базовий URL **Confluence** (без `/` в кінці), напр. `https://wiki.firma.lan` або `https://firma.atlassian.net` |
| `JIRA_SITE` | Ні | Базовий URL **Jira**, якщо відрізняється від `ATLASSIAN_SITE` (інший піддомен, хост або шлях `/jira`). За замовчуванням = `ATLASSIAN_SITE`. |
| `ATLASSIAN_EMAIL` | **Так** | Ім’я користувача Basic (Cloud: email; DC: часто логін Jira) |
| `ATLASSIAN_API_TOKEN` | **Так** | Пароль Basic (Cloud: API token; DC: пароль або PAT) |
| `OUTPUT_DIR` | Ні | Корінь виводу (за замовчуванням `output`) |
| `EXTRA_JQL` | Ні | Додатковий JQL через `OR` до автогенерації |
| `USE_RAW_JQL_ONLY` | Ні | Якщо `1` — використовується лише `RAW_JQL` |
| `RAW_JQL` | У режимі raw | Повний JQL замість автоматики |
| `CONFLUENCE_SPACE_KEYS` | Ні | Ключі просторів через кому; порожньо — усі простори з лістингу |
| `CONFLUENCE_MAX_PAGES_PER_SPACE` | Ні | Максимум сторінок на простір (типово `500`) |
| `CONFLUENCE_REST_PREFIX` | Ні | Примусово: `/rest/api` (типовий DC на окремому хості) або `/wiki/rest/api` (Cloud). Якщо не задано — **авто-перевірка** обох шляхів. |
| `JIRA_PAGE_SIZE` | Ні | Розмір сторінки пошуку Jira (макс. `100`) |
| `JIRA_REST_API_VERSION` | Ні | `2` або `3` — зафіксувати версію REST Jira; якщо порожньо — **авто** (спочатку v3, при 404 — v2). |
| `HTTPX_VERIFY_SSL` | Ні | `1` — перевіряти TLS (за замовчуванням); `0` / `false` / `off` — вимкнути (небезпечно; корпоративні CA). **Та сама назва** у Python і Node. |

**Node.js:** спочатку читається `.env` з **кореня репо** (шлях `../../.env` відносно `node/src/config.js`), потім — `.env` з **поточної робочої директорії**, щоб можна було перевизначити значення.

---

## Запуск (Python)

```bash
cd /шлях/до/jira-context
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
python -m app               # усе
python -m app jira
python -m app confluence
```

Після встановлення в venv може бути доступна команда `jira-context`.

---

## Запуск (Node.js)

```bash
cd /шлях/до/jira-context/node
npm install
npm run sync              # усе
npm run sync:jira
npm run sync:confluence
```

Або з кореня репозиторію:

```bash
node node/src/cli.js
node node/src/cli.js jira
```

Опційно: `npm install -g .` всередині `node/` і команда `jira-context-node`.

---

## Куди пишуться файли

```
output/
├── jira/
│   ├── _last_jql.txt          # Фактичний JQL останнього запуску (може бути кілька батчів)
│   ├── PROJECTKEY/
│   │   ├── PROJ-123.md
│   │   └── PROJ-123.json
│   └── ...
└── confluence/
    ├── _spaces.txt            # Простори останнього прогону
    ├── SPACEKEY/
    │   ├── nazva-storinky.md
    │   ├── nazva-storinky.json
    │   └── _sync_error.txt    # Лише якщо простір впав з помилкою
    └── ...
```

---

## Як працює пошук у Jira

**Базовий URL:** усі запити до Jira йдуть на **`JIRA_SITE`** (або на `ATLASSIAN_SITE`, якщо `JIRA_SITE` не задано).

**Версія API:** якщо `JIRA_REST_API_VERSION` не вказано, виконується `GET …/rest/api/3/field`; при відповіді **404** — fallback на **`…/rest/api/2/field`**. Можна явно задати `2` або `3`.

**Метадані та JQL**

1. `GET {jiraSite}/rest/api/{2|3}/field` (крім режиму лише `RAW_JQL`).  
2. **v3 (Cloud):** додаються `watcher` / `participant` і searchable user-поля з метаданих.  
3. **v2 (типовий DC):** лише `assignee` і `reporter`, щоб уникнути помилок JQL на DC.  
4. Фрагменти з’єднуються через `OR`; довгі рядки **розбиваються** на кілька запитів; ключі задач дедуплікуються.

**Пошук і пагінація**

- **v3:** `POST …/rest/api/3/search/jql` і токени `nextPageToken`.  
- **v2:** `POST …/rest/api/2/search` і пагінація `startAt` / `total`.

**Важливо:** на DC для «своїх» задач у конкретних проєктах часто потрібні **`EXTRA_JQL`** / **`RAW_JQL`**.

---

## Як працює експорт Confluence

1. **Базовий шлях REST:** якщо задано `CONFLUENCE_REST_PREFIX` (наприклад `/rest/api`), він використовується під `ATLASSIAN_SITE`. Інакше послідовно перевіряються **`/wiki/rest/api`** (стиль Cloud) і **`/rest/api`** (частий варіант DC з порожнім context path); перший шлях, де `GET …/space?start=0&limit=1` повертає **200**, обирається для всього синку.  
2. Ключі просторів — з `CONFLUENCE_SPACE_KEYS` або з пагінованого `GET {apiBase}/space`.  
3. Для кожного простору — `GET {apiBase}/content/search` з CQL `type=page AND space=KEY`.  
4. HTML → Markdown (`html2text` у Python, `html-to-text` у Node).

На великих інстансах варто обмежити `CONFLUENCE_SPACE_KEYS` і/або `CONFLUENCE_MAX_PAGES_PER_SPACE`, щоб не отримати години роботи й **429 Too Many Requests**.

---

## Обмеження

- Це **не повноцінний бекап**: без вкладень, без повної історії версій, без інкрементального «дельта-синку» в одному run.  
- **Jira:** покриття залежить від версії REST: на **v3** — широкий OR user-полів; на **v2 / DC** — мінімальний набір + ваші `EXTRA_JQL` / `RAW_JQL`.  
- **Confluence:** лише **сторінки** (не коментарі, не окремі типи контенту, якщо вони не є звичайною сторінкою).  
- **Ліміти API** — при великих обсягах можливі 429; логіка Node для Confluence робить кілька повторів після 429.

---

## Типові проблеми

| Симптом | Ймовірна причина | Що зробити |
|---------|------------------|------------|
| `401` / `403` | Облікові дані або URL | DC: username + пароль/PAT; Cloud: email + API token; перевірити `JIRA_SITE` / `ATLASSIAN_SITE` |
| Помилка TLS / сертифіката | Внутрішня CA, self-signed | Краще додати CA в довіру; або `HTTPX_VERIFY_SSL=0` (небезпечно) |
| Jira **404** на обох `/rest/api/3/field` і `/rest/api/2/field` | У `ATLASSIAN_SITE` вказано **Confluence**, а не Jira | Задати **`JIRA_SITE`** на корінь Jira |
| JQL і `watcher` / `participant` на DC | Немає у v2 | Це очікувано; розширити через `EXTRA_JQL` / `RAW_JQL` |
| Jira **400** з купою «поле не існує / немає прав» | Довгий OR user-полів на DC | Лишити **авто v2** або `JIRA_REST_API_VERSION=2` + `EXTRA_JQL` |
| `410` на `/rest/api/3/search` | Застарілий пошук у сторонньому коді | Тут для **v3** використовується **`/search/jql`** |
| Confluence **404** на `/wiki/rest/api/space` | DC без префікса `/wiki` | Увімкнути **авто-проб** або `CONFLUENCE_REST_PREFIX=/rest/api` |
| Порожні папки Confluence | Немає прав або невірний ключ простору | Подив. `_sync_error.txt`, перевір ключі |
| Дуже великий `output/` | Усі простори + усі задачі | Скоротити простори, додати фільтри в JQL |

---

## Безпека

- **Не комітьте `.env`** — він у `.gitignore`.  
- API token = секрет; при витоку — відкликати й створити новий.  
- У JSON можуть бути **ПІБ, email, внутрішні ідентифікатори** — ставтесь до `output/` як до конфіденційних даних.

---

## Python чи Node.js — що обрати

| Критерій | Python | Node.js |
|----------|--------|---------|
| Встановлення | `pip install -e .` | `npm install` у `node/` |
| HTTP | `httpx` | `fetch` + `undici` при `HTTPX_VERIFY_SSL=0` |
| HTML → Markdown | `html2text` | `html-to-text` |
| Зручність типізації | Анотації типів у коді | JSDoc + JS |

Змінні середовища, логіка **Jira v2/v3**, **`JIRA_SITE`**, **авто-префікс Confluence** і **TLS** узгоджені між Python і Node. Якщо щось розходиться — порівняйте `output/jira/_last_jql.txt` і JSON однієї задачі.

---

## Приклади `.env`

**Cloud (один сайт):**

```env
ATLASSIAN_SITE=https://your-site.atlassian.net
ATLASSIAN_EMAIL=you@company.com
ATLASSIAN_API_TOKEN=your_cloud_api_token
OUTPUT_DIR=output
CONFLUENCE_SPACE_KEYS=ENG,DOC
```

**Data Center (wiki і jira на різних піддоменах):**

```env
ATLASSIAN_SITE=https://wiki.firma.lan
JIRA_SITE=https://jira.firma.lan
ATLASSIAN_EMAIL=логін_jira
ATLASSIAN_API_TOKEN=пароль_або_pat
HTTPX_VERIFY_SSL=0
CONFLUENCE_SPACE_KEYS=ENG,DOC
```

Обмеження `CONFLUENCE_SPACE_KEYS` — найпростіший спосіб скоротити час синку Confluence.

---

## Швидкодія

- Спочатку запустіть лише Jira (`python -m app jira` або `node node/src/cli.js jira`), щоб перевірити токен і JQL.
- `JIRA_PAGE_SIZE` зменшуйте лише якщо є проблеми з розміром відповіді (рідко).
- Дуже великі сайти зручніше синкати в «тихі» години, щоб рідше ловити 429.

---

## Посилання

- [Jira Cloud REST v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)  
- [Jira Server / DC REST](https://docs.atlassian.com/software/jira/docs/api/REST/9.17.0/)  
- [JQL](https://support.atlassian.com/jira-service-management-cloud/docs/use-advanced-search-with-jira-query-language-jql/)  
- [Confluence Cloud REST](https://developer.atlassian.com/cloud/confluence/rest/v1/intro/)  
- [Confluence Server REST](https://docs.atlassian.com/atlassian-confluence/REST/9.2.0/)  
- [CQL](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/)  

---

## Підсумок

Скопіюйте `.env`, оберіть **Python** або **Node**, запустіть синк, підключайте каталог `output/` до контексту редактора або ШІ — отримаєте локальну копію задач і документації з **Cloud** або **власного Jira/Confluence**.
