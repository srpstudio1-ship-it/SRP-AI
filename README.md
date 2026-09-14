# SRP AI — Monetizable AI Product Starter

SRP AI is a full-stack AI product designed around a clear free-to-paid funnel instead of giving every expensive capability away for free.

## Product model
- Free: Basic AI chat + browser voice input.
- Pro Weekly: ₹100/week, with a 3-day trial concept in the product UI.
- Pro Monthly: ₹300/month.
- Pro Yearly: ₹2,000/year.
- Pro unlocks Smart, Reasoning, Coding and Call Assistant areas.

## Run
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Add `OPENAI_API_KEY`.
4. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
5. Run `npm install`.
6. Run `npm start`.
7. Open http://localhost:3000.

The app uses the OpenAI Responses API from the server, so the API key is never shipped to the browser. Web mode uses the model's web-search tool when enabled by the configured model/account.

## Google login
Configure a Google OAuth client and put its credentials in `.env`; the UI already has the Google login entry point. For production, add the OAuth callback/session implementation before going live.

## Payments
Razorpay is wired as the payment provider for order creation and signature verification. For true recurring billing, create Razorpay subscription plans and use server-side subscription/webhook handling before launch.

## Production upgrades
Replace the in-memory `Map` stores with PostgreSQL, add durable chat history, object storage for uploads, real Google OAuth callbacks, Razorpay subscriptions/webhooks, moderation, usage metering, email, phone provider integration, and observability.
