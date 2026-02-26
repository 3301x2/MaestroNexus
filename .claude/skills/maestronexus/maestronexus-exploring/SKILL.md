---
name: maestronexus-exploring
description: Navigate unfamiliar code using MaestroNexus knowledge graph
---

# Exploring Codebases with MaestroNexus

## When to Use

- "How does authentication work?"
- "What's the project structure?"
- "Show me the main components"
- "Where is the database logic?"
- Understanding code you haven't seen before

## Workflow

```
1. READ maestronexus://repos                          → Discover indexed repos
2. READ maestronexus://repo/{name}/context             → Codebase overview, check staleness
3. maestronexus_query({query: "<what you want to understand>"})  → Find related execution flows
4. maestronexus_context({name: "<symbol>"})            → Deep dive on specific symbol
5. READ maestronexus://repo/{name}/process/{name}      → Trace full execution flow
```

> If step 2 says "Index is stale" → run `npx maestronexus analyze` in terminal.

## Checklist

```
- [ ] READ maestronexus://repo/{name}/context
- [ ] maestronexus_query for the concept you want to understand
- [ ] Review returned processes (execution flows)
- [ ] maestronexus_context on key symbols for callers/callees
- [ ] READ process resource for full execution traces
- [ ] Read source files for implementation details
```

## Resources

| Resource                                | What you get                                            |
| --------------------------------------- | ------------------------------------------------------- |
| `maestronexus://repo/{name}/context`        | Stats, staleness warning (~150 tokens)                  |
| `maestronexus://repo/{name}/clusters`       | All functional areas with cohesion scores (~300 tokens) |
| `maestronexus://repo/{name}/cluster/{name}` | Area members with file paths (~500 tokens)              |
| `maestronexus://repo/{name}/process/{name}` | Step-by-step execution trace (~200 tokens)              |

## Tools

**maestronexus_query** — find execution flows related to a concept:

```
maestronexus_query({query: "payment processing"})
→ Processes: CheckoutFlow, RefundFlow, WebhookHandler
→ Symbols grouped by flow with file locations
```

**maestronexus_context** — 360-degree view of a symbol:

```
maestronexus_context({name: "validateUser"})
→ Incoming calls: loginHandler, apiMiddleware
→ Outgoing calls: checkToken, getUserById
→ Processes: LoginFlow (step 2/5), TokenRefresh (step 1/3)
```

## Example: "How does payment processing work?"

```
1. READ maestronexus://repo/my-app/context       → 918 symbols, 45 processes
2. maestronexus_query({query: "payment processing"})
   → CheckoutFlow: processPayment → validateCard → chargeStripe
   → RefundFlow: initiateRefund → calculateRefund → processRefund
3. maestronexus_context({name: "processPayment"})
   → Incoming: checkoutHandler, webhookHandler
   → Outgoing: validateCard, chargeStripe, saveTransaction
4. Read src/payments/processor.ts for implementation details
```
