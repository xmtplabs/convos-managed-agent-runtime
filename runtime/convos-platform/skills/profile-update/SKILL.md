---
name: profile-update
description: |
  Guidance for updating your profile: display name, profile photo (pfp, avatar, picture), and metadata.
  USE WHEN: Someone asks you to change your name, photo, pfp, avatar, profile picture, or set metadata. Also when you decide to change your own name/photo proactively. Also when you are selecting or evaluating an image URL to use as a profile image.
  DON'T USE WHEN: The request is a simple display name rename with no photo or metadata involved.
---

# Profile Updates — When and How

Your profile is per-conversation — changes only affect this group. Use your platform's profile tools to make changes (the exact commands are in your messaging context).

## Display Name

When someone gives you a new name, change it immediately. Do not announce you are changing it. Do not ask for confirmation. Just do it and confirm naturally in conversation.

## Profile Photo

The photo URL MUST be a publicly accessible HTTPS URL (e.g. https://example.com/photo.jpg). Local file paths do not work.

If someone wants to set your photo but does not provide a URL:
- If they share an image in chat, download the attachment first — but you still need a public URL to set as your profile image
- Suggest they paste a URL from the web, or share a link to an image they already have hosted
- Do not fabricate URLs or guess at image hosting services

### Image URL Safety Rules

1. **Do not use image URLs from training data without verifying them first.**
   URLs seen in training data may be stale, expired, deleted, moved, tokenized, or no longer public.

2. **Treat a URL as acceptable only after verification.**
   Verify that the URL:
   - is currently reachable
   - returns HTTP 200
   - returns Content-Type: image/*
   - does not require authentication, cookies, or a session
   - is not a temporary or signed URL unless temporary URLs are explicitly allowed

3. **Prefer direct static file URLs over dynamic image endpoints.**
   Accept URLs that look like direct file assets, for example paths ending in:
   `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`

4. **Reject or treat as unsafe any URL that appears dynamic or transform-generated.**
   Examples of suspicious patterns:
   - `thumb.php`, `api.php`, `Special:`, `w/index.php`
   - image resize/crop/transformation endpoints
   - query params suggesting expiration, signing, or per-request generation

5. **Do not judge safety by hostname alone.**
   A domain like `upload.wikimedia.org` can serve safe direct file URLs, but some related image URLs in the Wikimedia ecosystem may still be dynamic. Validate the full URL pattern and response, not just the domain.

6. **If verification is not possible, do not use the URL.**
   Do not guess that a URL is valid just because it looks familiar or came from training data.

## Metadata

Metadata fields are key=value pairs on your profile. They are per-conversation (not global). Use metadata for structured data the group wants visible on your profile (e.g. role, status, credits).

You can set multiple metadata fields at once. Keys are simple identifiers. Values are freeform strings.

## When to Update Proactively

- After your role in the group becomes clear, consider updating your name to reflect it
- If the group gives you a nickname or shorthand, adopt it immediately
- Do not change your name or photo without a reason — stability matters

### Examples

"Change your name to Scout."
BAD: "Sure! I'll update my name to Scout. Updating profile now... Done! My name is now Scout."
GOOD: PROFILE:Scout — then continues conversation naturally as Scout.

"Use this as your photo." [shares image in chat]
BAD: [sets profile image to a made-up URL]
GOOD: "I can see the image, but I need a public URL to set it as my photo — can you paste a link?"

"Set your profile pic to this Wikipedia image I remember."
BAD: [uses URL from training data without verifying]
GOOD: [fetches URL, verifies HTTP 200 + image content type] → sets it or reports the link is broken.
