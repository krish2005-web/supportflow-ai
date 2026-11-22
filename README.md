# SupportFlow AI — Powered by ResolveIQ

**SupportFlow AI** is an AI-powered customer support and ticket management platform built with FastAPI, PostgreSQL, Redis, Gemini AI and JavaScript.

The platform enables customers to raise and track support tickets, allows support agents to manage and resolve requests, and provides AI-powered assistance through **ResolveIQ**.

Its human-in-the-loop workflow ensures that AI-generated ticket recommendations and replies are reviewed and approved by support agents before being shared with customers.

## Features

### Customer
- Register and log in securely.
- Create and manage support tickets.
- View ticket status, priority and updates.
- Communicate with support agents.
- Ask ResolveIQ questions about their tickets and support policies.
- Reset forgotten passwords using OTP verification.

### Support Agent
- View assigned and unassigned tickets.
- Claim and manage support tickets.
- Analyse tickets using ResolveIQ.
- Generate AI-powered summaries, priority suggestions and draft replies.
- Review and approve AI-generated recommendations.
- Communicate with customers through ticket conversations.

### Admin
- View dashboard statistics.
- Manage users and roles.
- Assign tickets to support agents.
- View ticket information and AI analysis history.

### ResolveIQ AI
- AI-powered ticket analysis.
- Customer support chatbot.
- Knowledge-base retrieval using RAG.
- Local keyword-based document search.
- PostgreSQL with pgvector for vector search fallback where enabled.
- Redis caching for retrieved documents.
- Protection against requests for sensitive customer information.
- Policy-based fallback responses when Gemini is unavailable.

## Technology Stack

| Technology | Purpose |
|---|---|
| Python | Backend programming |
| FastAPI | REST API development |
| PostgreSQL | Relational database |
| SQLAlchemy | Database operations |
| Alembic | Database migrations |
| Redis | Caching and temporary data |
| pgvector | Vector similarity search |
| Gemini AI | AI-powered ticket analysis and chat |
| HTML, CSS, JavaScript | Frontend development |
| Docker | Application containerization |
| Docker Compose | Running application services |

## How ResolveIQ Works

ResolveIQ combines ticket information, knowledge-base retrieval and AI-generated responses.

1. The customer asks a question through the chat interface.
2. The backend checks whether the answer is already available in the ticket information.
3. Relevant support policies are retrieved from the knowledge base.
4. Redis caches retrieved documents to reduce repeated retrieval work.
5. When AI generation is required, Gemini uses the available ticket information and policy context to prepare an answer.
6. The customer receives the response along with relevant knowledge sources when available.

The retrieval system tries local keyword search first. PostgreSQL vector search is available as a fallback in retrieval flows where it is enabled.

## Project Architecture

```text
supportflow-ai/
│
├── alembic/
│
├── app/
│   ├── ai/
│   ├── core/
│   ├── db/
│   ├── models/
│   ├── routers/
│   ├── schemas/
│   ├── services/
│   ├── __init__.py
│   └── main.py
│
├── eval/
├── frontend/
├── knowledge_base/
├── scripts/
│
├── .dockerignore
├── .env                  # Local configuration only
├── .gitignore
├── alembic.ini
├── DEMO.md
├── docker-compose.yml
├── Dockerfile
├── README.md
└── requirements.txt
```

## Requirements

Make sure the following tools and services are available:

- Docker Desktop
- Python 3
- Git
- Gemini API key

## Setup Instructions

### 1. Open the project folder

Open PowerShell in the project root:

```powershell
cd path\to\supportflow-ai
```

### 2. Configure environment variables

Make sure a `.env` file exists in the project root.

Configure the required values, including:

- `POSTGRES_PASSWORD`
- `SECRET_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- Database connection settings
- Redis connection settings

Keep your existing `.env` file if it is already configured.

Never replace a working `.env` with an empty configuration. Never upload real credentials or API keys to GitHub.

### 3. Start Docker services

Run:

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

### 4. Apply database migrations

```powershell
docker compose exec api alembic upgrade head
```

### 5. Access the API

Once the services are running:

| Service | URL |
|---|---|
| API | http://localhost:8001 |
| Swagger documentation | http://localhost:8001/docs |
| Health check | http://localhost:8001/health |
| Diagnostics | http://localhost:8001/diagnostics |

### 6. Start the frontend

Open another PowerShell terminal:

```powershell
cd path\to\supportflow-ai\frontend
python -m http.server 5500
```

Open the application:

http://localhost:5500

If the browser displays an older version, press `Ctrl + Shift + R` to refresh the cached frontend assets.

## Creating User Accounts

### Customer Account

Register through the application's signup page.

Public registration creates customer accounts.

### Admin Account

From the project root, run:

```powershell
docker compose exec api python -m scripts.create_admin
```

Follow the prompts to create an administrator account.

### Support Agent Account

Run:

```powershell
docker compose exec api python -m scripts.create_agent
```

Follow the prompts to create a support agent account.

## Password Reset

The application supports OTP-based password reset.

For local testing without SMTP configuration, the OTP may be available in the API logs:

```powershell
docker compose logs --tail=100 api
```

For real deployments, configure SMTP to deliver OTPs through email. Do not rely on server logs to deliver OTPs to real customers.

## Knowledge Base

ResolveIQ uses Markdown documents containing internal support policies.

These documents are stored in:

```text
knowledge_base/
```

Examples include:

- `account_access.md`
- `payment_issues.md`
- `refund_policy.md`
- `security_policy.md`

To build or refresh the document index, run:

```powershell
docker compose exec api python -m app.ai.index_documents
```

## AI Evaluation

ResolveIQ includes a basic evaluation script that uses predefined questions stored in:

```text
eval/golden_questions.json
```

Run the evaluation:

```powershell
docker compose exec api python -m scripts.eval_resolveiq
```

The script checks whether answers contain expected phrases and avoid forbidden phrases.

This provides a basic automated check of expected responses. It is not a complete measure of semantic accuracy or AI reliability.

## Useful Docker Commands

**Check running services**

```powershell
docker compose ps
```

**View API logs**

```powershell
docker compose logs --tail=100 api
```

**Follow API logs**

```powershell
docker compose logs -f api
```

**Check Redis connection**

```powershell
docker compose exec redis redis-cli PING
```

Expected output:

```text
PONG
```

**Stop services**

```powershell
docker compose stop
```

**Start existing services**

```powershell
docker compose start
```

## Troubleshooting

### API is not responding

Check the running containers:

```powershell
docker compose ps
docker compose logs --tail=100 api
```

### Gemini is unavailable

Check the following in `.env`:

- Gemini API key
- Gemini model configuration

Also inspect the API logs:

```powershell
docker compose logs --tail=100 api
```

### Frontend is not loading

Make sure the frontend server is running from the `frontend` directory.

Check JavaScript syntax:

```powershell
node --check frontend/app.js
node --check frontend/config.js
```

### Database tables are missing

Apply the migrations:

```powershell
docker compose exec api alembic upgrade head
```

### Redis is not responding

Run:

```powershell
docker compose exec redis redis-cli PING
```

Expected output:

```text
PONG
```

## Security Notes

- Passwords must never be stored in plain text.
- Never request customer passwords, OTPs, CVVs or full card numbers.
- Keep API keys, database passwords and other secrets inside `.env`.
- Do not commit `.env` to GitHub.
- AI-generated ticket replies require support agent approval before being published to customers.
- Do not expose private customer information through AI responses.

## Demo

For a practical demonstration of customer, support agent, admin and ResolveIQ features, see:

[DEMO.md](./DEMO.md)

The demo guide includes example questions and workflows for testing the main application features.

## Resume Highlights

- Developed a role-based customer support ticket management platform using FastAPI and PostgreSQL.
- Integrated Gemini AI for automated ticket analysis and customer support assistance.
- Implemented RAG-based knowledge retrieval using internal support policy documents.
- Integrated Redis caching to improve repeated knowledge retrieval.
- Implemented human-in-the-loop approval for AI-generated support replies.
- Used PostgreSQL and pgvector for vector-based document retrieval where enabled.
- Containerized the application and its supporting services using Docker Compose.

## About

SupportFlow AI demonstrates the integration of modern backend technologies and AI capabilities to address a practical customer support problem.

**ResolveIQ** combines AI-powered ticket analysis, policy-grounded customer assistance and human approval workflows within a role-based support platform.

The project showcases practical experience with backend API development, database management, authentication, role-based access control, caching, containerization and AI integration.