# CLAUDE.md - Контекст проекта MWS-AI

> Этот файл содержит ключевую информацию о проекте для принятия правильных решений при разработке.

## 🎯 Суть проекта

**MWS-AI (Moderated Web Scanner AI)** — интеллектуальная система сканирования безопасности кода.

**Главная проблема**: Сканеры секретов (Gitleaks, Semgrep) генерируют множество ложных срабатываний (False Positives).

**Решение**: Использование AI/ML для автоматической классификации находок и фильтрации ложных срабатываний.

**Результат**: Снижение нагрузки на безопасность и разработчиков за счёт точной классификации.

---

## 🏗️ Архитектура: Микросервисы

### Принцип работы
```
GitHub Action/CI
  → Orchestrator (8000) - координация
    → Report Injector (8002) - нормализация отчётов
    → Moderator (8001) - AI-классификация
    → Audit (8003) - логирование
  ← Результат с классификацией TP/FP
```

### Сервисы и их ответственность

#### 1. Orchestrator (:8000)
**Роль**: API Gateway, координатор, хранилище задач
**Путь**: `src/orchestrator/`
**Ключевые файлы**:
- `app/main.py` - FastAPI endpoints: `/api/analyze`, `/api/reports/{id}`, `/api/token`
- `app/pipeline.py` - оркестрация между сервисами
- `app/clients.py` - HTTP-клиенты для других сервисов
- `app/schemas.py` - Pydantic модели

**Важно**:
- Создаёт JWT токены для аутентификации
- Хранит результаты анализа в памяти (словарь `tasks`)
- Управляет background tasks для асинхронной обработки

#### 2. Report Injector (:8002)
**Роль**: Нормализация разных форматов отчётов в единый
**Путь**: `src/report_injestor/`
**Ключевые файлы**:
- `app/parsers.py` - парсеры для SARIF, Semgrep, Generic JSON
- `app/schemas.py` - унифицированная модель `Finding`

**Важно**:
- Извлекает контекст: file_path, line_number, code_snippet
- Нормализует severity, rule_id, description
- Поддержка расширения: легко добавить новый формат в `parsers.py`

#### 3. Moderator (:8001) - **CORE AI SERVICE**
**Роль**: Классификация находок с использованием AI/ML
**Путь**: `src/moderator/`
**Ключевые файлы**:
- `app/pipeline.py` - трёхуровневый пайплайн классификации
- `app/heuristics.py` - быстрые правила (entropy, test files, keywords)
- `app/llm_detector.py` - LLM-анализ через Qwen API
- `app/catboost_model.cbm` - обученная ML-модель

**Важно - Трёхуровневая система**:
1. **Heuristics** (быстро, высокая уверенность):
   - Проверка энтропии строки
   - Детектирование тестовых файлов
   - Ключевые слова-маркеры (example, test, dummy)

2. **CatBoost ML** (средняя скорость):
   - Используется для confidence < 0.35 или > 0.65
   - Features: длина, энтропия, наличие спец. символов
   - Выдаёт вероятность: 0.0 (FP) → 1.0 (TP)

3. **Qwen LLM** (медленно, для сложных случаев):
   - Используется для 0.35 ≤ confidence ≤ 0.65
   - Анализирует контекст кода
   - Требует QWEN_API_KEY

**Логика принятия решений**:
```python
# src/moderator/app/pipeline.py
heuristic_result = check_heuristics(finding)
if heuristic_result.confidence < 0.35 or > 0.65:
    return heuristic_result

ml_result = catboost_classify(finding)
if ml_result.confidence < 0.35 or > 0.65:
    return ml_result

# Неуверенные случаи → LLM
llm_result = qwen_analyze(finding)
return llm_result
```

#### 4. Audit (:8003)
**Роль**: Централизованное логирование
**Путь**: `src/audit/`
**Ключевые файлы**:
- `app/main.py` - endpoint `/log` для приёма логов
- `logs/audit.jsonl` - хранилище логов (JSONL формат)

**Важно**:
- Все сервисы используют `src/common/audit_client.py` для логирования
- Каждый запрос имеет `trace_id` для корреляции логов
- Логи пишутся в append-режиме

### Frontend (:3000 / GitHub Pages)
**Роль**: Web UI для просмотра результатов и управления
**Путь**: `src/frontend/`
**Технологии**: Angular 20.3 + Nx 22.2
**Ключевые файлы**:
- `src/main.ts` - точка входа
- `src/app/app.routes.ts` - маршруты
- `src/app/components/` - standalone компоненты

**Страницы**:
- `/login` - авторизация
- `/register` - регистрация
- `/dashboard/main` - главная страница
- `/dashboard/kiosk-mode` - режим киоска для отображения результатов

**Важно**:
- Использует standalone components (новый подход Angular)
- Деплой на GitHub Pages через `gh-pages`
- Стили на LESS

### Общий код (src/common/)
**Файлы**:
- `audit_client.py` - клиент для логирования в Audit сервис
- `jwt_auth.py` - генерация и верификация JWT токенов

**Важно**: Используется всеми backend-сервисами как shared library

---

## 🔑 Ключевые концепции

### JWT-авторизация
- Orchestrator генерирует токены: `POST /api/token`
- Секрет из env: `JWT_SECRET_KEY` (default: `d4MVEyv61YKQpPL9vj01`)
- Время жизни: `JWT_EXPIRATION_HOURS` (default: 24h)
- Все `/api/*` endpoints требуют Bearer токен

### Формат данных

#### Finding (унифицированный формат)
```python
{
    "file_path": "src/config.py",
    "line_number": 42,
    "code_snippet": "API_KEY = 'secret123'",
    "rule_id": "generic-api-key-in-code",
    "description": "Potential hardcoded API key",
    "severity": "high"
}
```

#### Moderation Result
```python
{
    "is_true_positive": true,  # или false
    "confidence": 0.85,        # 0.0 - 1.0
    "reason": "High entropy string matching API key pattern",
    "method": "heuristics"     # или "ml" или "llm"
}
```

### Trace ID
- Каждый запрос получает уникальный `trace_id` (UUID)
- Передаётся через заголовки между сервисами
- Используется для корреляции логов в Audit

---

## 🚀 CI/CD и автоматизация

### GitHub Actions Workflow
**Файл**: `.github/workflows/secrets.yml`

**Триггеры**:
- Push в master
- Pull Request
- Manual dispatch (workflow_dispatch)

**Возможности**:
1. Сканирование текущего репозитория
2. Сканирование другого репозитория (параметр `target_repo`)
3. Выбор сканера: gitleaks, semgrep (matrix strategy)
4. Выбор ветки для сканирования

**Процесс**:
```bash
1. Checkout кода
2. Установка сканера (gitleaks/semgrep)
3. docker-compose up -d --build  # Запуск всех сервисов
4. scripts/ci/secrets_scan.sh    # Сканирование
5. Upload SARIF в GitHub Code Scanning
6. Fail если найдены True Positives
```

### Скрипт сканирования
**Файл**: `scripts/ci/secrets_scan.sh`

**Логика**:
1. Запускает сканер (gitleaks/semgrep) → SARIF файл
2. Получает JWT токен от Orchestrator
3. Отправляет SARIF на `/api/analyze`
4. Polling статуса задачи: `/api/reports/{task_id}`
5. Создаёт GitHub annotations для найденных TP
6. Exit code 1 если есть True Positives

**Важно**: Использует переменные окружения:
- `ORCH_URL` - URL Orchestrator (default: http://localhost:8000)
- `SCANNER` - gitleaks или semgrep
- `SCAN_DIR` - директория для сканирования
- `JWT_SECRET_KEY` - для получения токена

---

## 🐳 Docker и развёртывание

### Docker Compose
**Файл**: `docker-compose.yml`

**Сеть**: `mws-network` (bridge)

**Порядок запуска**:
1. Audit (независимый)
2. Moderator, Report Injector (зависят от Audit)
3. Orchestrator (зависит от всех)

**Важные env переменные**:
- `QWEN_API_KEY` - ключ для LLM (из secrets)
- `JWT_SECRET_KEY` - секрет для JWT (из secrets)
- `AUDIT_URL`, `MODERATOR_URL`, `REPORT_INJESTOR_URL` - URLs сервисов
- `DEBUG` - режим отладки (default: false)

**Volumes**:
- `./logs:/app/logs` - логи Audit сервиса

### Dockerfile паттерн
Все сервисы используют multi-stage build:
```dockerfile
# Build stage
FROM python:3.12-slim
COPY requirements.txt
RUN pip install
COPY src/common
COPY src/{service}/app

# Run
CMD uvicorn app.main:app --host 0.0.0.0 --port {PORT}
```

---

## 📝 Паттерны и конвенции

### Структура FastAPI сервисов
```
src/{service}/
├── Dockerfile
├── requirements.txt
└── app/
    ├── __init__.py
    ├── main.py       # FastAPI app, endpoints
    ├── schemas.py    # Pydantic models
    ├── config.py     # Configuration
    └── {logic}.py    # Бизнес-логика
```

### Логирование
**Всегда используй Audit client**:
```python
from common.audit_client import log_to_audit

log_to_audit(
    service="moderator",
    level="info",
    message="Classified finding",
    trace_id=trace_id,
    extra={"finding_id": "...", "result": "TP"}
)
```

### Обработка ошибок
- Используй HTTPException для API ошибок
- Логируй все исключения в Audit
- Возвращай детальные error messages для отладки

### Зависимости
- `requirements.txt` в каждом сервисе
- `src/common/requirements.txt` для общих зависимостей
- Frontend: `package.json` с Nx workspaces

---

## 🔧 Важные технические детали

### Moderator: Обучение ML модели
**Модель**: CatBoost (gradient boosting)
**Файл**: `src/moderator/app/catboost_model.cbm`

**Features** (признаки):
- Длина строки секрета
- Энтропия Шеннона
- Наличие цифр, букв, спец. символов
- Соотношение uppercase/lowercase
- Длина токенов при split

**Важно**: Модель обучена offline, не требует переобучения в runtime

### LLM Integration (Qwen)
**API**: Qwen через HTTP API
**Промпт** (в `llm_detector.py`):
```
Analyze this code snippet for hardcoded secrets.
File: {file_path}
Line: {line_number}
Code: {snippet}
Rule: {rule_id}

Is this a TRUE secret? Respond: TRUE or FALSE
Explanation: ...
```

**Rate limiting**: Нет встроенного, нужно учитывать при масштабировании

### SARIF формат
**Структура**:
```json
{
  "runs": [{
    "results": [{
      "ruleId": "...",
      "message": {"text": "..."},
      "locations": [{
        "physicalLocation": {
          "artifactLocation": {"uri": "file.py"},
          "region": {"startLine": 42, "snippet": {"text": "..."}}
        }
      }]
    }]
  }]
}
```

**Парсинг**: `src/report_injestor/app/parsers.py:parse_sarif()`

---

## 🚨 Известные особенности и ограничения

### Хранилище задач
**Проблема**: Orchestrator хранит задачи в памяти (словарь)
**Последствия**:
- При перезапуске контейнера задачи теряются
- Не масштабируется горизонтально
**TODO**: Рассмотреть Redis/PostgreSQL для персистентности

### Логи Audit
**Проблема**: Логи в JSONL файле, растут неограниченно
**Последствия**: Может закончиться место на диске
**TODO**: Rotation, архивация, или БД

### LLM зависимость
**Проблема**: Зависимость от внешнего API (Qwen)
**Риски**:
- Rate limits
- Network failures
- Задержки ответа
**Митигация**: Используется только для неуверенных случаев (0.35-0.65)

### Отсутствие персистентности
**Проблема**: Нет БД, всё в памяти/файлах
**Последствия**: Не подходит для production в текущем виде
**Подходит для**: CI/CD пайплайнов, разовых сканирований

---

## 🎨 Стиль кода и форматирование

### Python
- FastAPI endpoints с явными Pydantic models
- Type hints обязательны
- Async/await для I/O операций
- Logging через Audit client, не print()

### TypeScript/Angular
- Standalone components (без NgModule)
- LESS для стилей
- RxJS для асинхронности
- ESLint + Prettier для форматирования

---

## 📚 Полезные команды

### Локальная разработка
```bash
# Запуск всех сервисов
docker-compose up -d --build

# Просмотр логов
docker-compose logs -f orchestrator
docker-compose logs -f moderator

# Перезапуск одного сервиса
docker-compose restart orchestrator

# Остановка
docker-compose down
```

### CI сканирование
```bash
# Ручной запуск (требует running services)
export ORCH_URL=http://localhost:8000
export SCANNER=gitleaks
export SCAN_DIR=.
export JWT_SECRET_KEY=d4MVEyv61YKQpPL9vj01
bash scripts/ci/secrets_scan.sh
```

### Frontend
```bash
cd src/frontend
npm install
npm start          # Dev server
npm run build      # Production build
npm run deploy     # Deploy to GitHub Pages
```

---

## 🔍 Отладка и диагностика

### Проверка здоровья сервисов
```bash
curl http://localhost:8000/health  # Orchestrator
curl http://localhost:8001/health  # Moderator
curl http://localhost:8002/health  # Report Injector
curl http://localhost:8003/health  # Audit
```

### Получение JWT токена
```bash
curl -X POST http://localhost:8000/api/token \
  -H "Content-Type: application/json" \
  -d '{"username": "ci", "password": "secret"}'
```

### Просмотр логов Audit
```bash
cat logs/audit.jsonl | jq '.'
# Фильтр по trace_id
cat logs/audit.jsonl | jq 'select(.trace_id == "xxx")'
```

### Тестовый запрос анализа
```bash
TOKEN="your-jwt-token"
curl -X POST http://localhost:8000/api/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @test-sarif.json
```

---

## 🗺️ Roadmap и история

### Завершённые этапы
- ✅ Базовая микросервисная архитектура
- ✅ SARIF/Semgrep парсинг
- ✅ Трёхуровневая AI классификация
- ✅ Docker контейнеризация
- ✅ JWT авторизация
- ✅ GitHub Actions интеграция
- ✅ Angular frontend с auth
- ✅ Kiosk mode для отображения

### Текущая версия: v0.9
**Дата**: 16 декабря 2025
**Основные фичи**:
- Matrix strategy для multiple scanners
- Поддержка сканирования external repos
- Улучшенный CI workflow

### История веток
- `docker` → добавление контейнеризации и JWT
- `dev-front-main` → разработка frontend
- `ci` → настройка GitHub Actions (v0.1-v0.9)
- `moderator` → обновления AI pipeline

---

## 💡 Принципы принятия решений

### При добавлении нового функционала

1. **Какой сервис затронут?**
   - Парсинг нового формата → Report Injector
   - Новая логика классификации → Moderator
   - API endpoint → Orchestrator
   - Логирование/мониторинг → Audit
   - UI → Frontend

2. **Нужна ли персистентность?**
   - Краткосрочно (в рамках запроса) → память
   - Долгосрочно → TODO: добавить БД

3. **Асинхронность?**
   - I/O операции (HTTP, file) → async/await
   - CPU-bound (ML inference) → sync, но в background task

4. **Обработка ошибок**
   - Логировать в Audit с trace_id
   - Возвращать понятные HTTP коды
   - Не ломать весь пайплайн из-за одной находки

### При рефакторинге

1. **Сохранять обратную совместимость**
   - API contracts (schemas) стабильны
   - SARIF формат стандартный

2. **Тестировать с реальными данными**
   - Использовать gitleaks.sarif / semgrep.sarif
   - Проверять на public repos

3. **Документировать изменения**
   - Обновлять CLAUDE.md
   - Commit messages в формате `type: description`

---

## 🎓 Онбординг: с чего начать

### Первые шаги
1. Прочитать этот файл полностью
2. Запустить `docker-compose up -d --build`
3. Проверить работу через `scripts/ci/secrets_scan.sh`
4. Посмотреть логи: `cat logs/audit.jsonl | jq`

### Понимание кода
1. **Orchestrator** (`src/orchestrator/app/main.py`) - начни здесь
2. **Pipeline** (`src/orchestrator/app/pipeline.py`) - как работает flow
3. **Moderator Pipeline** (`src/moderator/app/pipeline.py`) - AI magic
4. **Parsers** (`src/report_injestor/app/parsers.py`) - форматы данных

### Эксперименты
1. Добавить новое эвристическое правило в `heuristics.py`
2. Создать тестовый SARIF файл и скормить в `/api/analyze`
3. Посмотреть trace через логи Audit
4. Изменить порог confidence для LLM (0.35-0.65)

---

## 📞 Контакты и ownership

### Основные контрибьюторы
- **crdlts** (nikitos2005190@gmail.com) - Backend, CI/CD, ML
- **m.iglovskiy** (Mikhail Iglovskiy) - Frontend
- **Rita** - Moderator improvements

### Репозиторий
- GitHub: [текущий репозиторий]
- Ветка разработки: `master`
- Feature branches: `claude/*`, `ci`, `docker`, `dev-front-main`

---

## ✅ Чеклист перед изменениями

- [ ] Понимаю, какой сервис затронут
- [ ] Знаю формат входных/выходных данных
- [ ] Обработаны ошибки и добавлено логирование
- [ ] Протестировано локально через docker-compose
- [ ] Обновлён CLAUDE.md при необходимости
- [ ] Commit message следует формату `type: description`
- [ ] Проверена обратная совместимость API

---

---

## 🔗 Frontend Integration (COMPLETED)

**Статус**: ✅ Интегрирован (17 декабря 2025)

### Что было сделано:

#### Backend изменения:
1. **CORS middleware** в Orchestrator (`src/orchestrator/app/main.py:28`)
   - Разрешены origins: localhost:4200, localhost, crdlts.github.io
   - Полная поддержка CORS для cross-origin requests

#### Docker интеграция:
2. **Frontend Dockerfile** (`src/frontend/Dockerfile`)
   - Multi-stage build: Node.js → Nginx
   - Production-ready Angular build

3. **Nginx конфигурация** (`src/frontend/nginx.conf`)
   - Angular routing support (SPA)
   - Gzip compression
   - Security headers
   - Static asset caching

4. **Docker Compose** (`docker-compose.yml:83`)
   - Frontend service на порту 4200
   - Зависимость от Orchestrator
   - Подключение к mws-network

#### Frontend код:
5. **Environment config** (`src/frontend/src/environments/`)
   - `environment.ts`: dev (localhost:8000)
   - `environment.prod.ts`: production (orchestrator:8000)

6. **API Models** (`src/frontend/src/app/core/models/api.models.ts`)
   - TypeScript интерфейсы для всех API responses
   - Полное соответствие backend Pydantic схемам

7. **Services**:
   - `AuthService` (`src/frontend/src/app/core/services/auth.service.ts`)
     - Получение JWT токена
     - Хранение в localStorage
     - Auth state management

   - `AnalysisService` (`src/frontend/src/app/core/services/analysis.service.ts`)
     - Submit анализ (`/api/analyze`)
     - Get report (`/api/reports/{id}`)
     - Polling с автоматическим обновлением

8. **HTTP Interceptor** (`src/frontend/src/app/core/interceptors/auth.interceptor.ts`)
   - Автоматическое добавление JWT токена в headers

9. **Components**:
   - Login интеграция с AuthService
   - Results component для отображения findings и stats

### Архитектура после интеграции:

```
┌─────────────────────────────────────┐
│  Browser: http://localhost:4200     │
│                                      │
│  Angular Frontend (Nginx)            │
│  ├─ Login → AuthService             │
│  ├─ Dashboard → AnalysisService     │
│  └─ Results → API data display      │
│                                      │
│      ↓ HTTP + JWT                    │
└──────────────────────────────────────┘
               ↓
┌──────────────────────────────────────┐
│  Docker Network: mws-network         │
│                                       │
│  Orchestrator :8000                  │
│  ├─ /api/token (JWT)                │
│  ├─ /api/analyze (submit)           │
│  └─ /api/reports/{id} (results)     │
│                                       │
│  Moderator :8001                     │
│  Report Injector :8002               │
│  Audit :8003                         │
└──────────────────────────────────────┘
```

### Как запустить:

```bash
# Запуск всего стека (включая frontend)
docker-compose up -d --build

# Frontend доступен на http://localhost:4200
# Backend API на http://localhost:8000

# Для разработки frontend отдельно:
cd src/frontend
npm install
npm start  # Dev server на http://localhost:4200
```

### API Flow пример:

```typescript
// 1. Login
authService.getToken().subscribe(res => {
  // JWT сохранён в localStorage
  // Автоматически добавляется в все requests
});

// 2. Analyze
analysisService.analyze({
  tool: 'gitleaks',
  report: sarifJson
}).subscribe(res => {
  console.log('Report ID:', res.report_id);
});

// 3. Poll for results
analysisService.pollReport(reportId).subscribe(res => {
  if (res.status === 'completed') {
    console.log('Findings:', res.findings);
    console.log('Stats:', res.stats);
  }
});
```

### Следующие шаги (опционально):

- [ ] Добавить route для `/dashboard/results/:id`
- [ ] Upload SARIF файлов через UI
- [ ] Визуализация статистики (графики)
- [ ] WebSocket для real-time updates вместо polling
- [ ] Export результатов в JSON/CSV
- [ ] Фильтрация и поиск по findings

---

**Последнее обновление**: 17 декабря 2025 (Frontend Integration)
**Версия документа**: 1.1
**Автор**: Claude (AI assistant)
