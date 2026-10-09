# Nayi Voice

I am building Nayi Voice as a multilingual AI front desk for real businesses. My goal is simple: help a business answer every important call, complete routine work automatically, and hand sensitive or complex conversations to a human with full context.

This is an original clean-room project. I am not reusing the source code, brand, or interface of the reference prototype that inspired the initial exploration.

## What I want Nayi Voice to do

A customer should be able to call a normal business phone number and speak naturally in Hindi, Hinglish, or English. The AI receptionist should answer questions, qualify enquiries, book appointments, send confirmations, remember customer context, and transfer the caller when human help is appropriate.

The business owner uses a responsive web application to configure the agent and understand what is happening:

- Create a private business workspace
- Configure identity, opening hours, services, prices, and escalation numbers
- Teach the AI approved answers through a knowledge base
- Test the receptionist from a browser without phone charges
- Review calls, outcomes, customers, bookings, and follow-ups
- Control whether the agent is accepting calls

## Current product milestone

- Responsive operations dashboard
- Workspace registration and login
- Password hashing and signed authentication tokens
- Multi-tenant SQLite schema with WAL mode and indexes
- Agent Studio for business profile, personality, languages, and instructions
- Services and pricing management
- FAQ knowledge base
- Call-history and customer-directory screens
- Appointment creation, scheduling, search, and status management
- Browser microphone and text-to-speech test experience
- Groq-powered conversational responses
- Grounded AI replies using stored services, pricing, hours, and approved FAQs
- Automatic provider-key failover for reliability
- Safe local fallback when an AI provider is not configured
- API validation and integration smoke tests

## Technology

- React, TypeScript, and Vite
- Express API
- SQLite for the current local-first milestone
- Groq for fast language-model responses
- Browser speech recognition and speech synthesis for free development testing

## Project structure

```text
nayi-voice/
├── server/             API, authentication, database, and AI providers
├── src/                React web application
├── data/               Local runtime database (ignored by Git)
├── .env.example        Environment variable contract
├── package.json        Scripts and dependencies
└── vite.config.ts      Web development configuration
```

## Run locally

Use Node.js 24 or newer for the current built-in SQLite implementation.

```bash
npm install
copy .env.example .env
npm run dev:api
npm run dev
```

The web application runs through Vite and proxies `/api` requests to the local API service.

## Verification

```bash
npm run build
npm run test:api
```

The API smoke test covers registration, authentication, agent state, business setup, services, knowledge entries, and an AI response.

## Security

I keep `.env`, local databases, build output, and runtime logs out of Git. API keys must only be placed in `.env`. Any key exposed in a chat, screenshot, or commit should be revoked and replaced.

## Roadmap

1. Complete appointments and customer workflows
2. Add structured AI tools for availability and booking
3. Add production speech-to-text and text-to-speech adapters
4. Connect a telephony provider with verified signed webhooks
5. Add WhatsApp confirmations and human handoff
6. Move production workloads to managed PostgreSQL and Redis
7. Add roles, billing, observability, retention controls, and deployment automation

The web product comes first. A native mobile application is a later milestone after the core workflows are reliable.
