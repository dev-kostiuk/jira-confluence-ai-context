# jira-context (документація українською)

**jira-context** копіює задачі з **Jira** і сторінки з **Confluence** у звичайні файли в каталозі `output/`. Мета — дати асистентам з кодом (або вам) **швидкий, зручний для пошуку та grep контекст**, прив’язаний до того ж сайту Atlassian Cloud, яким ви вже користуєтесь.

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
- `watcher = currentUser()` — ви спостерігач *(на частині продуктів/тарифів JQL може не підтримуватись)*  
- `participant in (currentUser())` — ширша евристика «участі» в задачі  
- Усі поля з метаданих `/rest/api/3/field`, де `searchable: true` і тип **один користувач** або **мульти-вибір користувачів** (стандартні й кастомні поля)

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

- Сайт **Atlassian Cloud** (`*.atlassian.net`) з **Jira** і за бажанням **Confluence**  
- Обліковий запис з правами на потрібні задачі та простори  
- **Python 3.10+** або **Node.js 18+** (у Node використовується вбудований `fetch`)

---

## Автентифікація

1. Створіть **API token**: [керування токенами Atlassian](https://id.atlassian.com/manage-profile/security/api-tokens).  
2. Використовується **HTTP Basic**: email як ім’я користувача, **API token** як пароль (не пароль від веб-логіну).  
3. Обидва CLI додають заголовок `Authorization: Basic …` до кожного запиту.

Видимість така ж, як у браузері: приватні задачі чи закриті простори в експорт не потраплять.

---

## Конфігурація

Скопіюйте `.env.example` у файл **`.env` у корені репозиторію** (рекомендовано — тоді зручно і Python, і Node).

| Змінна | Обов’язкова | Опис |
|--------|-------------|------|
| `ATLASSIAN_SITE` | **Так** | Базовий URL, напр. `https://firma.atlassian.net` (без `/` в кінці) |
| `ATLASSIAN_EMAIL` | **Так** | Email облікового запису |
| `ATLASSIAN_API_TOKEN` | **Так** | API token |
| `OUTPUT_DIR` | Ні | Корінь виводу (за замовчуванням `output`) |
| `EXTRA_JQL` | Ні | Додатковий JQL через `OR` до автогенерації |
| `USE_RAW_JQL_ONLY` | Ні | Якщо `1` — використовується лише `RAW_JQL` |
| `RAW_JQL` | У режимі raw | Повний JQL замість автоматики |
| `CONFLUENCE_SPACE_KEYS` | Ні | Ключі просторів через кому; порожньо — усі простори з лістингу |
| `CONFLUENCE_MAX_PAGES_PER_SPACE` | Ні | Максимум сторінок на простір (типово `500`) |
| `JIRA_PAGE_SIZE` | Ні | Розмір сторінки пошуку Jira (макс. `100`) |

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

1. Запит `GET /rest/api/3/field` — метадані полів.  
2. Для кожного поля з `searchable: true` і типу користувач / масив користувачів додається фрагмент JQL (ім’я поля в лапках для кастомних полів).  
3. Усі фрагменти об’єднуються через `OR`. Якщо рядок завеликий — **розбиття на кілька JQL**.  
4. Пошук: `POST /rest/api/3/search/jql` (актуальний для Jira Cloud; старий `/rest/api/3/search` може повертати **410 Gone**).  
5. Пагінація: `nextPageToken` до `isLast` або поки токен не зникне.

**Важливо:** універсального JQL «поточний користувач у будь-якому полі взагалі» не існує. Поля без `searchable`, деякі плагіни або згадки лише в розмітці можуть **не потрапити** в видачу — тоді допомагають `EXTRA_JQL` / `RAW_JQL`.

---

## Як працює експорт Confluence

1. Ключі просторів — з `CONFLUENCE_SPACE_KEYS` або з пагінованого `GET /wiki/rest/api/space`.  
2. Для кожного простору — `GET /wiki/rest/api/content/search` з CQL `type=page AND space=KEY`.  
3. HTML → Markdown (`html2text` у Python, `html-to-text` у Node).

На великих інстансах варто обмежити `CONFLUENCE_SPACE_KEYS` і/або `CONFLUENCE_MAX_PAGES_PER_SPACE`, щоб не отримати години роботи й **429 Too Many Requests**.

---

## Обмеження

- Це **не повноцінний бекап**: без вкладень, без повної історії версій, без інкрементального «дельта-синку» в одному run.  
- **Jira:** покриття лише тим, що можна виразити через підтримувані JQL-умови та searchable user-поля.  
- **Confluence:** лише **сторінки** (не коментарі, не окремі типи контенту, якщо вони не є звичайною сторінкою).  
- **Ліміти API** — при великих обсягах можливі 429; логіка Node для Confluence робить кілька повторів після 429.

---

## Типові проблеми

| Симптом | Ймовірна причина | Що зробити |
|---------|------------------|------------|
| `401` / `403` | Токен або URL | Перевірити токен, email, `ATLASSIAN_SITE`, права в Jira/Confluence |
| Помилка JQL про `watcher` / `participant` | Не підтримується на вашому плані | `USE_RAW_JQL_ONLY=1` + свій `RAW_JQL` |
| `410` на `/rest/api/3/search` | Застарілий endpoint у сторонньому скрипті | У цьому проєкті використовується `/search/jql` |
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
| HTTP | `httpx` | Вбудований `fetch` |
| HTML → Markdown | `html2text` | `html-to-text` |
| Зручність типізації | Анотації типів у коді | JSDoc + JS |

Поведінка та шляхи файлів задумані як однакові; якщо щось розходиться — порівняйте `output/jira/_last_jql.txt` і JSON однієї задачі з обох запусків.

---

## Приклад мінімального `.env`

```env
ATLASSIAN_SITE=https://your-site.atlassian.net
ATLASSIAN_EMAIL=you@company.com
ATLASSIAN_API_TOKEN=your_token_here
OUTPUT_DIR=output
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

- [Jira Cloud REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)  
- [JQL](https://support.atlassian.com/jira-service-management-cloud/docs/use-advanced-search-with-jira-query-language-jql/)  
- [Confluence Cloud REST](https://developer.atlassian.com/cloud/confluence/rest/v1/intro/)  
- [CQL](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/)  

---

## Підсумок

Скопіюйте `.env`, оберіть **Python** або **Node**, запустіть синк, підключайте каталог `output/` до контексту редактора або ШІ — отримаєте стабільну локальну копію релевантних задач і документації з Atlassian Cloud.
