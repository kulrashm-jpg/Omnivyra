'use client';

/**
 * The two creative questions the Creator never asked.
 *
 * The engines behind this screen already decide how an image should look and
 * who should be in it — a ten-profile director engine and a forty-nine entry
 * style registry, both reached only by inference from the brief. A user who
 * wanted a graffiti treatment, or explicitly wanted nobody in the frame, had no
 * way to say so and no way to see what had been decided for them.
 *
 * These two steps are that missing conversation, and they are deliberately
 * phrased as questions a person would ask rather than settings a system would
 * expose. Nothing here invents a concept: every option maps onto vocabulary the
 * existing engines already speak.
 *
 * The styles are shown as PICTURES. "Graffiti" means nothing to someone who has
 * never briefed a designer; a photograph of graffiti means everything. A real
 * showcase render exists for every style in the registry, so the choice is made
 * by looking rather than by reading.
 */

import React from 'react';
import { ArrowLeft, Check, Sparkles } from 'lucide-react';
import {
  listVisualDirections,
  visualDirectionsByGroup,
  recommendVisualDirections,
  SUBJECT_OPTIONS,
  type SubjectChoice,
  type VisualDirection,
} from '../../lib/content/guidedCreativeDirection';
import type { TemplateAssetFamily } from '../../lib/creator-templates/types';
import { color, radius, shadow, space, fontSize, fontWeight } from '../../lib/platform/ui';

const card: React.CSSProperties = {
  border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surface,
  boxShadow: shadow.sm, textAlign: 'left', overflow: 'hidden', cursor: 'pointer', padding: 0,
};
const label: React.CSSProperties = {
  fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: color.textSubtle,
  textTransform: 'uppercase', letterSpacing: 0.4,
};
const linkBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: space.xs, background: 'transparent',
  border: 'none', color: color.primary[600], cursor: 'pointer', fontSize: fontSize.sm,
  padding: 0, fontWeight: fontWeight.semibold,
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: space.sm, background: color.primary[600],
  color: color.onPrimary, border: 'none', borderRadius: radius.md,
  padding: `${space.md}px ${space.xl}px`, cursor: 'pointer',
  fontWeight: fontWeight.bold, fontSize: fontSize.sm,
};

/* ── One style, shown as a picture ──────────────────────────────────────────*/

function DirectionCard({
  direction, selected, recommended, onSelect,
}: {
  direction: VisualDirection;
  selected: boolean;
  recommended?: boolean;
  onSelect: () => void;
}) {
  /* A showcase render exists for every registry style, but a missing file must
   * degrade to the style's own accent swatch rather than a broken image — an
   * empty frame tells the user nothing about how their creative will feel. */
  const [imageFailed, setImageFailed] = React.useState(false);
  const showImage = Boolean(direction.previewUrl) && !imageFailed;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        ...card,
        borderColor: selected ? color.primary[600] : color.border,
        borderWidth: selected ? 2 : 1,
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 10', background: direction.surface }}>
        {showImage ? (
          <img
            src={direction.previewUrl!}
            alt=""
            onError={() => setImageFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, ${direction.accent}, ${direction.surface})` }} />
        )}
        {selected ? (
          <div style={{
            position: 'absolute', top: 8, right: 8, background: color.primary[600], color: color.onPrimary,
            borderRadius: 999, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Check size={13} /></div>
        ) : null}
        {recommended && !selected ? (
          <div style={{
            position: 'absolute', top: 8, left: 8, background: color.surface, color: color.text,
            borderRadius: 999, padding: '2px 8px', fontSize: 10.5, fontWeight: fontWeight.bold,
          }}>Suggested</div>
        ) : null}
      </div>
      <div style={{ padding: `${space.sm}px ${space.md}px ${space.md}px` }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{direction.title}</div>
        <div style={{ fontSize: 12, color: color.textMuted, marginTop: 3, lineHeight: 1.4 }}>{direction.description}</div>
      </div>
    </button>
  );
}

/* ── "How should it look?" ──────────────────────────────────────────────────*/

export function VisualDirectionStep({
  family, outcomeId, industry, value, onChange, onBack, onContinue,
}: {
  family: TemplateAssetFamily;
  outcomeId?: string | null;
  industry?: string | null;
  value: string | null;
  onChange: (id: string | null) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const recommended = React.useMemo(
    () => recommendVisualDirections({ family, outcomeId, industry }),
    [family, outcomeId, industry],
  );
  const grouped = React.useMemo(() => visualDirectionsByGroup(family), [family]);
  const total = React.useMemo(() => listVisualDirections(family).length, [family]);
  const recommendedIds = new Set(recommended.map((d) => d.id));

  return (
    <div>
      <button type="button" style={{ ...linkBtn, marginBottom: 10 }} onClick={onBack}>
        <ArrowLeft size={14} /> Back
      </button>
      <h2 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 6px' }}>How should it look?</h2>
      <p style={{ fontSize: 13.5, color: color.textMuted, margin: '0 0 18px', lineHeight: 1.5 }}>
        Pick a look, or skip it and we&rsquo;ll choose one that suits your brief.
      </p>

      {!showAll ? (
        <>
          <div style={{ ...label, marginBottom: 10 }}>Suggested for you</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {recommended.map((d) => (
              <DirectionCard
                key={d.id}
                direction={d}
                recommended
                selected={value === d.id}
                onSelect={() => onChange(value === d.id ? null : d.id)}
              />
            ))}
          </div>
          <button type="button" style={{ ...linkBtn, marginTop: 14 }} onClick={() => setShowAll(true)}>
            See all {total} looks →
          </button>
        </>
      ) : (
        <>
          <button type="button" style={{ ...linkBtn, marginBottom: 14 }} onClick={() => setShowAll(false)}>
            ← Back to suggestions
          </button>
          {grouped.map((bucket) => (
            <div key={bucket.group} style={{ marginBottom: 26 }}>
              <div style={{ ...label, marginBottom: 10 }}>{bucket.group}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                {bucket.directions.map((d) => (
                  <DirectionCard
                    key={d.id}
                    direction={d}
                    recommended={recommendedIds.has(d.id)}
                    selected={value === d.id}
                    onSelect={() => onChange(value === d.id ? null : d.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 24 }}>
        <button type="button" style={primaryBtn} onClick={onContinue}>Continue</button>
        {!value ? (
          <span style={{ fontSize: 12.5, color: color.textMuted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={13} /> No pick needed — AI will choose the look.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ── "What should be featured?" ─────────────────────────────────────────────*/

export function SubjectStep({
  value, onChange,
}: {
  value: SubjectChoice | null;
  onChange: (choice: SubjectChoice | null) => void;
}) {
  /* `ai` is the default and is shown as a real option rather than as an absence,
   * so the user can see that "we decide" is a choice they are making. */
  const effective: SubjectChoice = value ?? 'ai';
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ ...label, marginBottom: 4 }}>What should be featured?</div>
      <p style={{ fontSize: 12.5, color: color.textMuted, margin: '0 0 10px' }}>
        Who or what the picture is about.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        {SUBJECT_OPTIONS.map((o) => {
          const selected = effective === o.choice;
          return (
            <button
              key={o.choice}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(o.choice === 'ai' ? null : o.choice)}
              style={{
                ...card, cursor: 'pointer', padding: `${space.sm}px ${space.md}px`,
                borderColor: selected ? color.primary[600] : color.border,
                borderWidth: selected ? 2 : 1,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 800 }}>{o.label}</div>
              <div style={{ fontSize: 12, color: color.textMuted, marginTop: 3, lineHeight: 1.4 }}>{o.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
