---
name: himalaya-email
description: Use the Himalaya email CLI only when it is installed and an account is already configured. Use to search, read, draft, or prepare mail while verifying recipients and leaving new external sends for approval.
---

# Himalaya email

## When to use

Use for email work that can be completed through an already configured Himalaya CLI.

## Prerequisites

Check that `himalaya` is available and that an account is already configured. Do not create accounts, request secrets in terminal input, or assume an identity.

## Procedure

1. Identify account, mailbox, message criteria, and the user's requested action.
2. For reading, search narrowly and open only the relevant messages.
3. For a draft or reply, confirm the exact recipients, subject, and requested content before preparing it.
4. Re-read the draft or message metadata before reporting it.

## Verification

Verify mailbox, message identity, and draft contents through Himalaya output. Treat a send as an external effect and use the runtime's new-recipient approval boundary.

## Failure and stop conditions

Stop if Himalaya, account access, the message target, or recipient identity is unavailable or ambiguous. Do not send mail merely because a draft was prepared.
