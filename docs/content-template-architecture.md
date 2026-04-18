# Content Template Architecture

This document captures the target architecture for all long-form and structured content generation.

## Principles

- Keep user-created templates data-driven by default.
- Promote only high-value template families into dedicated generator files.
- Use one dispatcher per content type.
- Reuse shared scoring, repair, template resolution, and execution policy modules.

## Current Direction

- `newsletter` already follows the promoted-family dispatcher model.
- `blog` is being aligned to the same pattern.
- `article`, `guide`, `story`, and `whitepaper` now share a common managed-generation foundation and can grow dedicated family runners later without changing the API surface.
- `post` and `thread` now execute through dedicated short-form runner files backed by the master-to-variant pipeline.
- `case-study` now has its own API entrypoint while reusing the managed long-form execution path.

## Target Execution Model

For each content type:

1. System template cards
2. Recommended template cards
3. Custom templates
4. Execution with quality scoring, repair, and audit parity

The shared registry should be rich enough to support cards directly:

- template name
- description
- content type
- format type
- execution strategy
- recommended-for hints

The frontend should consume a shared card model rather than rebuilding cards independently on each content page.

## Promotion Ladder

1. Generic custom template
2. Managed template with metadata
3. Promoted first-class template with dedicated runner

## Shared Building Blocks

- Template registry / resolver
- Execution strategy resolver
- Quality profile metadata
- Depth profile metadata
- Shared repair and scoring

## Next Expansion Targets

- `post` UI surfaces
- `thread` UI surfaces
- `case-study` UI surfaces

These should follow the same product model as long-form content:

- subcategory cards
- recommended cards
- custom templates
- scored execution
