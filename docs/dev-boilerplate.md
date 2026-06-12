# Bemoat dev boilerplate

Target repository: `boat1994/bemoat-web-starter`

## Included

- Generic project CMS schema
- Categories and tags
- Blog categories
- Blog media
- Blog posts with content blocks
- Site settings global
- Custom order page global
- Frontend pages for home, projects, blog, and custom order
- Payload admin import map placeholders for AI extension points

## Intentionally not included yet

The order operations, LINE, payment slip, copilot, and handoff modules from previous project work are not included in this first boilerplate pass because they depend on project-specific collections, secrets, external APIs, and operational workflows.

## After pulling this change

Run these commands locally before serious deployment:

```bash
pnpm install
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Then review the generated migration before deploying to Cloudflare D1.
