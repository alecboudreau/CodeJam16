---
name: The Enforcer
description: A composed, character-led workspace for keeping project commitments.
colors:
  canvas: "#f3f4f0"
  surface: "#fff"
  surface-soft: "#eef1eb"
  rail: "#e9eee7"
  ink: "#26382f"
  muted: "#59665e"
  subtle: "#657168"
  line: "#dce2d8"
  line-strong: "#7d8d7a"
  pine: "#315b48"
  pine-hover: "#254937"
  pine-soft: "#e3ece2"
  ochre: "#795a22"
  ochre-soft: "#f2eddf"
  clay: "#9b4538"
  clay-soft: "#f8ebe6"
typography:
  display:
    fontFamily: "Public Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Public Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Public Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Public Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0em"
  label:
    fontFamily: "Public Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0em"
  supporting:
    fontFamily: "Public Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0em"
rounded:
  panel: "12px"
  control: "7px"
  field: "8px"
  status: "4px"
  progress: "2px"
spacing:
  compact: "8px"
  control-gap: "12px"
  group: "16px"
  content: "24px"
  stack: "28px"
components:
  button-primary:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.pine-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "23px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
  navigation-active:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
  status:
    rounded: "{rounded.status}"
    padding: "3px 7px"
---

# Design System: The Enforcer

## Overview

**Creative North Star: "The Composed Project Steward"**

A composed project steward keeps commitments visible. Pale mineral surroundings and white working surfaces make a practical, information-rich workspace feel calm. Pine actions and restrained outlines provide clear hierarchy without theatrical effects.

The Enforcer supplies the warmth: a watchful charcoal rook in a green chore jacket, with an ochre beak and clipboard. His appearances accompany guidance, onboarding, feedback and progress rather than becoming decoration on every control. Public Sans keeps the interface precise and approachable.

**Key Characteristics:**
- Calm mineral surfaces and pine actions.
- Compact, readable working density.
- Restrained corners and outlined SVG icons.
- A firm, friendly character used at meaningful moments.

## Colors

Muted green working tones carry the identity; warm attention and error tones remain functional signals. The frontmatter records the source custom properties. Legacy utility color names are remapped to this palette in the stylesheet, so a `blue` utility renders as green rather than introducing a separate brand accent.

### Primary
- **Pine** and **Pine Hover** mark primary actions and active navigation. **Pine Soft** gives Enforcer briefings a calm tonal field.

### Secondary
- **Ochre** and **Ochre Soft** support attention. Utility-built attention panels also use the implemented amber aliases.
- **Clay** and **Clay Soft** indicate errors; the interface pairs them with explanatory text and recovery actions.

### Neutral
- **Mineral Canvas** surrounds **White Surface** work panels.
- **Soft Surface** and **Rail** separate supporting regions without elevation.
- **Ink** is the main text; **Muted** and **Subtle** carry supporting information.
- **Line** divides regions; **Strong Line** outlines fields and secondary controls.

**The Pine Action Rule.** Use pine for primary actions, the active navigation item and progress; reserve ochre and clay for attention and errors.

## Typography

**Display Font:** Public Sans with the system sans-serif fallback stack.
**Body Font:** Public Sans with the same fallback stack. The variable font is self-hosted at `/fonts/public-sans.ttf`; its license accompanies the font assets.

The shared family feels clear and steady. Weight and size do the hierarchy work; text stays in sentence case. The compact support text is deliberate working density, not a separate decorative style.

### Hierarchy
- **Display:** the large authentication story heading; use the display role sparingly.
- **Headline:** page headings; mobile reduces them to (1.75rem).
- **Title:** Enforcer briefing headings; mobile reduces them to (1.25rem). Section headings use (1.0625rem), panel and task headings (0.9375rem), with task headings increasing to (1rem) on phones.
- **Body:** base reading type. Forms and page descriptions commonly use (0.875rem); longer supporting copy uses generous line-height. Page descriptions cap at (65ch).
- **Label:** compact buttons and navigation. Supporting metadata uses the supporting role, and percentages use tabular numerals.

## Layout

The desktop shell places a fixed left rail (236px) beside a utility header and centered working area with a maximum width of (1376px). Main padding is (38px). The rail becomes (212px) below (1200px), and (250px) from (1600px). The main page stack uses (28px) gaps; panel and task interior spacing is typically (18–24px), depending on viewport and component.

Dashboard work has a flexible main column and a supporting column (280px), narrowing to (250px) below (1200px). Below (960px), supporting content moves beneath the main column, initially in two columns. Setup similarly moves from a work-and-guide arrangement to one column, with the guide compacted above the form.

Below (768px), the rail becomes an in-flow disclosure beneath the utility bar, with a two-column navigation grid. CSS orders the utility bar, disclosed rail, main content and footer in that sequence. In mock mode the visible Sample data label remains in the mobile header; that header expands to (90px) minimum height with (28px) bottom padding to accommodate it. Content follows in reading order, with main padding (25px 20px), a single supporting column and stacked table rows with visible cell labels. At (390px) and below, horizontal main padding drops to (16px). The desktop rail scrolls vertically when its contents exceed the viewport; short desktop viewports also hide the decorative steward region. Form controls on phones use (1rem) text; button and standard field targets are at least (44px) high, while desktop compact filter controls use (36px).

The rhythm is predominantly multiples of four and eight, with optical adjustments such as (23px) panel padding and (26px) dashboard gaps. Preserve these implemented adjustments rather than forcing every measurement onto a theoretical grid.

## Elevation & Depth

The interface is flat. Background tone, white surfaces, fine borders and whitespace convey grouping. There is no ambient card-shadow vocabulary. Field focus uses an outlined border and a subtle two-pixel ring; global keyboard focus is a three-pixel pine outline with a three-pixel offset.

**The Quiet Surface Rule.** Separate working regions through pale tone, whitespace and fine borders; do not add decorative elevation.

## Shapes

Working panels and cards use the panel radius; primary, secondary and navigation controls use the control radius. Utility-built fields retain the slightly rounder field radius. Status labels use small corners rather than large pills. Progress tracks are slim with almost square corners. Circular member initials are a specific identity device. The brand symbol has a small asymmetric lower corner, rather than changing the shape of the wider component system.

## Components

### Buttons

Compact and confident. Primary buttons use pine with white text, secondary buttons white with a strong outline, and quiet buttons transparent with muted text. The shared button uses the label role and the frontmatter padding. Hover darkens primary pine, softens secondary surfaces, and gives quiet actions a pale fill. Press reduces brightness to (0.96); disabled buttons use half opacity. Icon controls retain a full hit target and accessible name. State transitions use the fast duration; there is no hover lift.

### Chips

Status labels use compact padding and the status radius. Their semantic colors come from green success, ochre attention and clay error aliases. Filter buttons are related controls with a (5px) radius: selected filters have a white fill and strong outline; hover adds pine-soft. Status information is expressed in text as well as color.

### Cards / Containers

White panels with a fine line border and panel corners. The standard panel uses the frontmatter padding; task cards use (22px), reducing or adjusting responsively. Supporting colored blocks remain flat. Keep headings and supporting content aligned to the same internal edge.

### Inputs / Fields

White fields have strong-line borders, field corners and (8px 12px) padding. Setup focus shifts the border to its green utility alias and adds a pale two-pixel ring; disabled fields use the canvas and subtle text. Selection controls use pine accents. Textareas resize vertically. Field labels remain visible rather than relying on placeholders.

### Read-only Plan Summaries

An active Task map displays descriptions and labeled task facts as wrapping text rather than disabled form controls. The task summary is a two-column definition grid with a full-width description, (18px 24px) gaps and (0.875rem) values at (1.7) line-height; phone column gaps narrow to (20px). Repository paths appear on their own lines and may break anywhere. Checkpoint summaries use block borders and (18px) vertical padding. Their criteria are wrapping (0.9375rem) headings at weight (600), followed by flex-wrapped date, target and agreement facts. Editable plans retain their actual input controls.

### Navigation

The desktop rail uses compact outlined SVG icons and label-sized text. Active items are solid pine with white text; hover uses a pale green fill. Count badges use a fine current-color border and small corners. Mobile navigation is an explicit in-flow disclosure, preserving route labels and keyboard access. Opening it moves focus to the first route link. Escape closes it and returns focus to the toggle; choosing a route closes it and moves focus to the main content.

### The Enforcer

Use `public/brand/enforcer.png` and `enforcer-small.png`, keeping the natural (2:3) proportions with contained sizing. The rook is charcoal, wears a green chore jacket and carries a clipboard; his ochre beak ties into the warmer palette. A briefing is a low, wide tonal panel with left-aligned copy and the character at the right. Empty states and onboarding give him more room; loading and error feedback reduce him to a small companion. The character communicates watchfulness and support without replacing labels or factual status.

### Progress and Feedback

Progress pairs a numeric percentage with a pine bar on a soft track, (6px) high or (8px) for overall project progress. The activity timeline uses pine lines and points, neutral grid lines and an accessible data table. Loading uses pale lines with a (1.6s) opacity animation. Errors use clay text and pale clay panels with a recovery action when available. Reduced motion disables animation and effectively removes transitions.

## Do's and Don'ts

### Do:
- **Do** keep actions legible against pale working surfaces.
- **Do** use the supplied Enforcer artwork with its natural proportions.
- **Do** preserve text labels, keyboard focus, reduced motion and the mobile reading order.
- **Do** pair status color with explicit status text.

### Don't:
- **Don't** substitute emoji or font glyphs for the outlined SVG icon system.
- **Don't** enlarge the mascot until it competes with the task or evidence being reviewed.
- **Don't** introduce glossy effects or decorative shadows into the flat working surfaces.
