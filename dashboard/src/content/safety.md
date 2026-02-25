---
title: Safety & Privacy
description: How Convos AI assistants handle your messages, what data is shared, and how your privacy is protected.
---

# Safety & Privacy

## How Convos AI assistants handle your messages and protect your privacy.

**Convos the app** is open source, end-to-end encrypted, and built so that nobody — including us — can read your messages. It is the most secure messaging app available.

**AI assistants** are a separate, hosted service layered on top. When you add an assistant to a group conversation, that assistant processes your messages in order to respond and take actions. This data is processed on infrastructure operated by XMTP Labs.

> Treat assistants the same way you'd treat any AI platform — ChatGPT, Gemini, Claude — your conversations with them are processed by the service provider. Don't put anything in front of an assistant that you wouldn't put in front of any other AI service.

## What the assistant can see

The assistant reads messages in your group conversation in order to respond and take actions.

**Messages in the group.** The assistant can see messages sent by anyone in the conversation. It uses these to understand context and respond helpfully.

**Only that group.** Each assistant is fully isolated. It cannot see other conversations, contacts, profiles, or any data outside the group it was added to.

**Nothing else.** No cross-pollination between groups. No access to your other chats. No shared memory across different conversations.

## One conversation per assistant

Every assistant is bound to a single conversation. It is created fresh with its own credentials, memory, and context — none of which are shared with any other assistant.

When the conversation ends, the assistant and all its data are destroyed. No residual data, no lingering access, no archive.

## What each assistant is made of

Every assistant runs on [OpenClaw](https://github.com/xmtplabs/openclaw), an open-source agent runtime built by XMTP Labs. When you add an assistant to a conversation, it gets provisioned with its own isolated set of credentials for the following services:

| Service | Provider | What it does |
| --- | --- | --- |
| **LLM routing** | [OpenRouter](https://openrouter.ai) | Routes prompts to the model provider best suited for each task. |
| **AI models** | [Anthropic](https://anthropic.com), [OpenAI](https://openai.com), [Google](https://deepmind.google/technologies/gemini/), [Meta](https://llama.meta.com), [DeepSeek](https://deepseek.com), and others | Your messages are sent to whichever model the assistant selects — Claude, GPT, Gemini, Llama, etc. Each provider has its own data policies. |
| **Web search** | [Perplexity](https://www.perplexity.ai) via OpenRouter | Real-time web lookups. Queries are sent to Perplexity's Sonar model through OpenRouter. |
| **Email** | [AgentMail](https://agentmail.to) | Each assistant gets a unique inbox. Emails sent and received by the assistant pass through AgentMail's API. |
| **SMS & phone** | [Telnyx](https://telnyx.com) | Each assistant can be assigned a US phone number. Text messages and calls are routed through Telnyx. |
| **Crypto wallet** | [Bankr](https://bankr.bot) | On-chain wallet for trading and transfers. Transaction requests are processed through Bankr's API. |
| **Web browsing** | Chromium (local) | A headless browser running on the same server as the assistant. No third-party service involved. |
| **Messaging** | [XMTP](https://xmtp.org) | The assistant communicates with your group over the XMTP network, the same protocol Convos uses for all messages. |

Each assistant gets its own API keys for these services, created at startup and destroyed when the conversation ends. No keys are shared across assistants. The assistant runtime, hosting infrastructure, and all provisioning are operated by XMTP Labs on [Railway](https://railway.com).

## Sensitive information

Because anyone in the group can interact with the assistant, be mindful before sharing information you wouldn't want an AI service to process:

- Passwords and authentication credentials
- Financial account numbers
- Government-issued ID numbers
- Medical records or health information

## You are in control

**Remove the assistant anytime.** Any group member can remove the assistant from the conversation at any time.

**Explode the convo.** Delete the conversation entirely and the assistant plus all its data are permanently destroyed.

**Keep chatting without it.** Your conversations without an assistant remain fully end-to-end encrypted. Adding an assistant is always opt-in.

---

**Bottom line:** Convos = private, encrypted, open source. AI assistants = hosted service with the same trust model as any other AI platform. Use them for what they're great at, but don't put anything in front of an assistant that you wouldn't put in front of any other AI service.
