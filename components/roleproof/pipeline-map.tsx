'use client';

/**
 * The Map — the Lead page's single artifact, and the whole point of the CI
 * (Lead Page as Pipeline Canvas §2.4/§2.5).
 *
 * Three columns: the CV's real structure on the left, evidence in the middle
 * lanes, job requirements on the right, connected by traced curves. It replaces a
 * sequential one-requirement-at-a-time wizard, which structurally could not show
 * that requirements are many-to-many with evidence — one requirement is often
 * supported by several items across several positions, and that relationship was
 * invisible in a flow that walked you through one pairing at a time.
 *
 * ONE component with six population states, not six components. It mounts at
 * capture with the frame already final — full CV skeleton, empty lanes, empty
 * right side — and fills in as each B step runs. That's what makes the page a
 * canvas showing the pipeline's work accumulate rather than a set of panels
 * describing it, and it's why nothing here is conditionally unmounted: the frame
 * must not move as data arrives.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from './kit';

export type MapLane = { heading: string; slot: string | null; starRef: string | null };
export type MapPosition = { refCode: string | null; title: string | null; company: string | null; lanes: MapLane[] };
/**
 * The CV's non-position sections — Education, Executive Education, Languages.
 * Same lane machinery as a position, no company/refCode: B6 cites `EDU-*`/`LANG-*`
 * (its note §B.1.2 tells it to), and until these existed those citations had no
 * lane to land in and silently vanished from the Map. See `getCredentialSkeleton`.
 */
export type MapCredentialSection = { heading: string; lanes: MapLane[] };
export type MapRequirement = {
  id: string;
  order: number | null;
  rank: string | null;
  requirement: string;
  description: string | null;
  /** The verbatim JD sentence (job_requirements.source_text). Null on leads screened before §3 shipped. */
  sourceText: string | null;
  initialScore: number | null;
  initialMatchStrength: string | null;
};
/**
 * One evidence item as it appears in a lane.
 *
 * `requirementIds` is a LIST, and that is the whole many-to-many claim this
 * component was built to make. It used to be a single `requirementId`, which meant
 * a bullet supporting five requirements had to arrive as five separate rows — so
 * the lane rendered the same sentence five times, and clicking any one of them lit
 * up exactly one requirement. The file's own header promised the opposite ("click
 * an item to see every requirement it serves"); this is what makes that true.
 */
export type MapEvidence = {
  id: string;
  requirementIds: string[];
  slot: string | null;
  text: string | null;
  approvalStatus: string;
  /** B6's reason(s) for the link (`requirement_evidence.note`). Absent on C2 rows. */
  note?: string | null;
  /** Stable identity of the underlying evidence (its ref code) — what duplicate rows are collapsed on. */
  groupKey?: string | null;
};
/** Roadblocks that name a requirement (§2.5). Unmapped ones never reach here — they live in Key Patterns. */
export type MapBlock = { requirementId: string; detail: string; dimension: string };

/**
 * Requirement tier → colour band. A saturation ramp, not three unrelated hues:
 * darker means more important, so the right edge of the column scans as a weight
 * profile before a single word is read (§2.4).
 *
 * Colour is never the only carrier — every band also gets the rank name as
 * `title` + `aria-label`, and the three labels appear once as a legend in the
 * subheader. Repeating the label on every row is what the band exists to avoid.
 */
const TIER: Record<string, { band: string; label: string }> = {
  Core: { band: 'bg-[#0C447C]', label: 'Core' },
  Important: { band: 'bg-[#85B7EB]', label: 'Important' },
  'Nice-to-Have': { band: 'bg-[#DFEAF6] ring-1 ring-inset ring-[#B5D4F4]', label: 'Nice-to-have' },
};
const TIER_FALLBACK = { band: 'bg-hairline', label: 'Unranked' };
const tierOf = (rank: string | null) => (rank && TIER[rank]) || TIER_FALLBACK;

/**
 * Assessment values. Sourced from B6's `initial_match_strength`, except `Block`,
 * which comes from a roadblock and outranks any fulfilment value — a blocked
 * requirement is not "partially met", it's gated (§2.5).
 */
const ASSESSMENT: Record<string, { dot: string; text: string }> = {
  Excellent: { dot: 'bg-[#1d9e75]', text: 'text-proof-deep' },
  'Very Strong': { dot: 'bg-[#1d9e75]', text: 'text-proof-deep' },
  Strong: { dot: 'bg-[#5dcaa5]', text: 'text-proof-deep' },
  Good: { dot: 'bg-[#5dcaa5]', text: 'text-proof-deep' },
  Moderate: { dot: 'bg-[#ef9f27]', text: 'text-caution-deep' },
  Partial: { dot: 'bg-[#ef9f27]', text: 'text-caution-deep' },
  Weak: { dot: 'bg-[#e24b4a]', text: 'text-drop-deep' },
  'No Match': { dot: 'bg-[#e24b4a]', text: 'text-drop-deep' },
  Gap: { dot: 'bg-[#e24b4a]', text: 'text-drop-deep' },
};

/** approval_status → chip colour. Reuses the existing enum rather than inventing a
 *  parallel vocabulary for the same three states (§2.4).
 *
 *  `initial` is not an approval_status — it is B6's machine-proposed evidence, which
 *  has no human verdict yet and must not borrow the vocabulary of one. It falls
 *  through to the neutral fallback below, so the lanes read as populated-but-
 *  unjudged until C2's rows replace them. */
const EVIDENCE_TONE: Record<string, string> = {
  green: 'border-proof-ring bg-proof-soft text-proof-deep',
  yellow: 'border-caution-ring bg-caution-soft text-caution-deep',
  red: 'border-drop-ring bg-drop-soft/70 text-drop-deep',
};
const EVIDENCE_FALLBACK = 'border-hairline bg-raised text-ink-muted';

export function PipelineMap({
  positions,
  credentials,
  requirements,
  evidence,
  blocks,
  leadTitle,
  company,
}: {
  positions: MapPosition[];
  credentials: MapCredentialSection[];
  requirements: MapRequirement[];
  evidence: MapEvidence[];
  blocks: MapBlock[];
  leadTitle: string;
  company: string | null;
}) {
  // `active` is a requirement id or an evidence id — one selection drives tracing
  // in both directions, which is what makes the many-to-many visible: click a
  // requirement to see every item supporting it, click an item to see every
  // requirement it serves.
  const [active, setActive] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const blockByReq = new Map(blocks.map((b) => [b.requirementId, b]));

  // Collapse the same evidence item appearing many times in one lane into a single
  // chip that carries every requirement it serves. B6 emits one row per
  // (requirement, bullet) pair, so on a real lead one project lane arrived with 13
  // rows covering 3 distinct bullets — the same sentence stacked four deep. Merging
  // here rather than at the query keeps the DB honest (the pairs ARE the mapping)
  // while the Map shows the evidence once, which is how a reader thinks about it.
  const items: MapEvidence[] = [];
  const byLaneKey = new Map<string, MapEvidence>();
  const notesByKey = new Map<string, string[]>();
  for (const e of evidence) {
    // `approvalStatus` is part of the key on purpose. C2 writes one row per
    // requirement, so two requirements can pick the same bullet and then be triaged
    // differently — Keep for one, Drop for the other. Those are two different
    // statements about the same sentence and must stay two chips; collapsing them
    // would silently show one verdict and hide the other. B6's rows are all
    // `initial`, so this never blocks the merge it exists for.
    const key = `${e.slot ?? ''}|${e.groupKey ?? e.id}|${e.approvalStatus}`;
    const hit = byLaneKey.get(key);
    if (hit) {
      for (const r of e.requirementIds) if (!hit.requirementIds.includes(r)) hit.requirementIds.push(r);
    } else {
      const copy = { ...e, requirementIds: [...e.requirementIds] };
      byLaneKey.set(key, copy);
      items.push(copy);
    }
    // Each pair carried its own reason; keep them all, one per line in the tooltip,
    // rather than arbitrarily surfacing whichever row happened to be first.
    if (e.note) {
      const list = notesByKey.get(key);
      if (list) {
        if (!list.includes(e.note)) list.push(e.note);
      } else notesByKey.set(key, [e.note]);
    }
  }
  for (const [key, merged] of byLaneKey) merged.note = notesByKey.get(key)?.join('\n') ?? null;

  const evidenceBySlot = new Map<string, MapEvidence[]>();
  for (const e of items) {
    if (!e.slot) continue;
    const list = evidenceBySlot.get(e.slot);
    if (list) list.push(e);
    else evidenceBySlot.set(e.slot, [e]);
  }

  const activeReqIds = new Set<string>();
  const activeEvIds = new Set<string>();
  if (active) {
    const asEvidence = items.find((e) => e.id === active);
    if (asEvidence) {
      activeEvIds.add(asEvidence.id);
      for (const r of asEvidence.requirementIds) activeReqIds.add(r);
    } else {
      activeReqIds.add(active);
      for (const e of items) if (e.requirementIds.includes(active)) activeEvIds.add(e.id);
    }
  }

  const hasRequirements = requirements.length > 0;
  const hasEvidence = items.length > 0;
  // B6 stamps every requirement it judged, so this is the honest test for "the
  // scoring pass has run" — without it, a lead B6 legitimately found no evidence
  // for is indistinguishable from one B6 has not reached, and both read as
  // "lanes fill at B6". That ambiguity is what opened this CI.
  const scored = requirements.some((r) => r.initialMatchStrength);

  return (
    <div className="mt-5 overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline bg-raised px-4 py-3">
        <span className="text-[13px] font-semibold text-ink">Requirement → evidence map</span>
        <span className="text-[11px] text-ink-subtle">
          {!hasRequirements
            ? 'the frame is final — requirements arrive at B2, evidence at B6'
            : !hasEvidence
              ? scored
                ? 'B6 scored these against the Master Bullet Bank and placed nothing — read each row’s assessment for why'
                : 'requirements in — evidence lanes fill at B6'
              : 'click any requirement or evidence item to trace the link'}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => setActive(null)}
            className="ml-auto text-[11px] font-semibold text-proof-deep hover:underline"
          >
            Clear trace
          </button>
        )}
      </div>

      <div ref={boardRef} className="relative grid grid-cols-1 lg:grid-cols-[1.5fr_1fr]">
        <TraceLines boardRef={boardRef} activeReqIds={activeReqIds} activeEvIds={activeEvIds} />

        {/* LEFT + MIDDLE · the CV skeleton, with evidence placed into its lanes.
            Sectioned the way the real CV prints — Professional Experience, then
            Education / Executive Education / Languages — rather than positions
            alone, so that every kind of evidence B6 is told to cite has somewhere
            to land. The technical provenance caption stays, demoted: it explains
            where the lanes come from, it is not the reader's heading. */}
        <div className="relative z-[1] border-hairline lg:border-r">
          <ColHead title="From your career graph" sub="from positions · cv_position → cv_heading" />
          <SectionHead>Professional Experience</SectionHead>
          {positions.map((p, i) => (
            <div key={p.refCode ?? i} className={cn('border-t border-hairline/60', i === 0 && 'border-t-0')}>
              <div className="px-3 pb-1 pt-2 text-[12px] font-semibold text-ink">
                {p.title ?? p.refCode ?? 'Position'}
                {p.company && <span className="font-normal text-ink-subtle"> · {p.company}</span>}
              </div>
              {p.lanes.map((lane) => (
                <Lane
                  key={`${lane.slot ?? 'noslot'}-${lane.heading}`}
                  lane={lane}
                  items={lane.slot ? evidenceBySlot.get(lane.slot) ?? [] : []}
                  activeEvIds={activeEvIds}
                  onPick={(id) => setActive((cur) => (cur === id ? null : id))}
                />
              ))}
            </div>
          ))}
          {credentials.map((section) => (
            <div key={section.heading}>
              <SectionHead>{section.heading}</SectionHead>
              {section.lanes.map((lane) => (
                <Lane
                  key={`${lane.slot ?? 'noslot'}-${lane.heading}`}
                  lane={lane}
                  items={lane.slot ? evidenceBySlot.get(lane.slot) ?? [] : []}
                  activeEvIds={activeEvIds}
                  onPick={(id) => setActive((cur) => (cur === id ? null : id))}
                />
              ))}
            </div>
          ))}
        </div>

        {/* RIGHT · job requirements + the assessment strip */}
        <div className="relative z-[1]">
          <ColHead
            title={[leadTitle, company].filter(Boolean).join(' · ')}
            sub="assessment · requirement & original JD text · order · tier"
          />
          {!hasRequirements ? (
            <p className="px-4 py-7 text-center text-[11.5px] italic text-ink-subtle">
              No requirements extracted yet.
              <br />
              They arrive when B2 runs.
            </p>
          ) : (
            <>
              {/* The assessment strip is visually separated — its own subheader and a
                  heavier divider — because it is a judgment about the candidate, while
                  everything right of it is a fact about the posting. */}
              <div className="grid grid-cols-[84px_1fr] items-center border-b border-hairline bg-raised/60">
                <div className="border-r-[1.5px] border-hairline py-1.5 pl-3 text-[9px] font-bold uppercase tracking-[0.04em] text-ink-subtle">
                  Assessment
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-2 pr-2 text-[9px] font-bold uppercase tracking-[0.04em] text-ink-subtle">
                  <span>Job requirement &amp; original JD text</span>
                  {/* The three tier labels appear HERE and only here — never per row. */}
                  <span className="ml-auto flex items-center gap-2.5">
                    {(['Core', 'Important', 'Nice-to-Have'] as const).map((rank) => (
                      <span key={rank} className="flex items-center gap-1.5 text-[9.5px] font-semibold normal-case tracking-normal text-ink-muted">
                        <i className={cn('block h-3 w-[7px] rounded-[3px]', TIER[rank].band)} />
                        {TIER[rank].label}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
              {requirements.map((r) => (
                <RequirementRow
                  key={r.id}
                  req={r}
                  block={blockByReq.get(r.id)}
                  hot={activeReqIds.has(r.id)}
                  onClick={() => setActive((cur) => (cur === r.id ? null : r.id))}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ColHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border-b border-hairline bg-raised px-3 py-[7px]">
      <div className="text-[9.5px] font-bold uppercase tracking-[0.05em] text-ink-subtle">{title}</div>
      <div className="mt-0.5 text-[9.5px] text-ink-subtle/80">{sub}</div>
    </div>
  );
}

/**
 * A CV section heading — Professional Experience, Education, Languages.
 *
 * Deliberately heavier than the position titles nested under it and lighter than
 * the column head above it, so the left column reads in the same three levels the
 * printed CV does: section → role → lane. It also does the C-phase's groundwork:
 * once C2 widens evidence to the whole Career Graph, the sections it fills are
 * already drawn here.
 */
function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-hairline bg-raised/70 px-3 py-[5px] text-[10px] font-bold uppercase tracking-[0.06em] text-ink first:border-t-0">
      {children}
    </div>
  );
}

/**
 * One lane and whatever evidence sits in it. Extracted when the credential
 * sections arrived so positions and credentials cannot drift apart — the empty
 * copy, the chip tone and the `data-map-ev` hook the trace curves measure from all
 * have to stay identical, or a curve silently stops being drawable for half the
 * column.
 */
function Lane({
  lane,
  items,
  activeEvIds,
  onPick,
}: {
  lane: MapLane;
  items: MapEvidence[];
  activeEvIds: Set<string>;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex border-t border-dashed border-hairline/50">
      <div className="flex w-[118px] shrink-0 items-center border-r border-dashed border-hairline/50 py-[7px] pl-3 pr-1.5 text-[10px] leading-tight text-ink-muted">
        {lane.heading}
      </div>
      <div className="flex min-h-[34px] flex-1 flex-col gap-1.5 px-2 py-1.5">
        {items.length === 0 ? (
          <span className="pt-1 text-[9.5px] text-ink-subtle/60">
            {lane.slot ? 'no evidence placed' : 'not on the 2-page CV'}
          </span>
        ) : (
          items.map((e) => (
            <button
              key={e.id}
              type="button"
              data-map-ev={e.id}
              title={e.note ?? undefined}
              onClick={() => onPick(e.id)}
              className={cn(
                'w-full rounded-[4px] border px-2 py-1.5 text-left text-[10.5px] leading-[1.4] transition',
                EVIDENCE_TONE[e.approvalStatus] ?? EVIDENCE_FALLBACK,
                activeEvIds.has(e.id) && 'ring-[1.5px] ring-inset ring-proof-deep'
              )}
            >
              {e.text ?? '—'}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function RequirementRow({
  req,
  block,
  hot,
  onClick,
}: {
  req: MapRequirement;
  block: MapBlock | undefined;
  hot: boolean;
  onClick: () => void;
}) {
  const tier = tierOf(req.rank);
  return (
    <div
      role="button"
      tabIndex={0}
      data-map-req={req.id}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'grid cursor-pointer grid-cols-[84px_1fr_20px_16px] border-t border-hairline/60 text-left transition',
        hot && 'bg-proof-soft/25'
      )}
    >
      <div className={cn('border-r-[1.5px] border-hairline py-2 pl-3 pr-1', hot ? 'bg-proof-soft/40' : 'bg-raised/40')}>
        <Assessment req={req} block={block} />
      </div>
      <div className="py-2 pl-2 pr-2">
        <div className="text-[11px] font-medium leading-snug text-ink">{req.requirement}</div>
        {req.description && (
          <div className="mt-0.5 text-[11px] leading-[1.45] text-ink-muted">{req.description}</div>
        )}
        {/* The posting's own words, quoted rather than paraphrased. Absent on leads
            screened before source_text shipped — §4.3 chose not to re-run B2 across
            the back catalogue, so this says so instead of rendering an empty box. */}
        {req.sourceText ? (
          <div className="mt-1 border-l-2 border-hairline pl-2 text-[10px] italic leading-[1.4] text-ink-subtle">
            „{req.sourceText}“
          </div>
        ) : (
          <div className="mt-1 text-[9.5px] italic text-ink-subtle/70">no JD quote captured for this requirement</div>
        )}
      </div>
      <div className="py-2 text-right text-[10px] text-ink-subtle">{req.order ?? '—'}</div>
      <div className="flex items-stretch py-1 pr-2">
        <div
          className={cn('w-[7px] shrink-0 rounded-[4px]', tier.band)}
          title={`${tier.label} requirement`}
          aria-label={`${tier.label} requirement`}
        />
      </div>
    </div>
  );
}

function Assessment({ req, block }: { req: MapRequirement; block: MapBlock | undefined }) {
  // A roadblock outranks any fulfilment value. It is not a worse score on the same
  // scale — it's a different statement: this one gates the lead (§2.5).
  if (block) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#7a1f1f] px-1.5 py-0.5 text-[10px] font-bold text-white"
        title={`${block.dimension}: ${block.detail}`}
      >
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#ffb3b3]" />
        Block
      </span>
    );
  }
  if (!req.initialMatchStrength) {
    return <span className="text-[10px] italic text-ink-subtle/70">pending</span>;
  }
  const a = ASSESSMENT[req.initialMatchStrength];
  return (
    <span className={cn('flex items-center gap-1.5 text-[10px] font-bold', a?.text ?? 'text-ink-muted')}>
      <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', a?.dot ?? 'bg-ink-subtle')} />
      {req.initialMatchStrength}
    </span>
  );
}

/**
 * The traced curves. Drawn as an SVG overlay measured from the live DOM rather
 * than from a layout model, because the two columns are independently sized and
 * scrollable — anything computed from assumed geometry drifts the moment a
 * requirement wraps to a third line.
 */
function TraceLines({
  boardRef,
  activeReqIds,
  activeEvIds,
}: {
  boardRef: React.RefObject<HTMLDivElement>;
  activeReqIds: Set<string>;
  activeEvIds: Set<string>;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const reqKey = [...activeReqIds].sort().join(',');
  const evKey = [...activeEvIds].sort().join(',');

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board || !reqKey || !evKey) {
      setPaths([]);
      return;
    }
    const base = board.getBoundingClientRect();
    setBox({ w: base.width, h: base.height });
    const next: string[] = [];
    for (const evId of evKey.split(',')) {
      const evEl = board.querySelector<HTMLElement>(`[data-map-ev="${evId}"]`);
      if (!evEl) continue;
      const e = evEl.getBoundingClientRect();
      for (const reqId of reqKey.split(',')) {
        const reqEl = board.querySelector<HTMLElement>(`[data-map-req="${reqId}"]`);
        if (!reqEl) continue;
        const r = reqEl.getBoundingClientRect();
        const x1 = e.right - base.left;
        const y1 = e.top + e.height / 2 - base.top;
        const x2 = r.left - base.left;
        const y2 = r.top + r.height / 2 - base.top;
        const dx = Math.max(28, (x2 - x1) / 2);
        next.push(`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
      }
    }
    setPaths(next);
  }, [boardRef, reqKey, evKey]);

  // Layout effect so the curves land in the same paint as the row highlight —
  // measuring in a passive effect makes them visibly lag the click.
  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    if (!reqKey || !evKey) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, reqKey, evKey]);

  if (paths.length === 0) return null;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[2] overflow-visible"
      width={box.w}
      height={box.h}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#185fa5" strokeWidth={1.25} strokeOpacity={0.55} />
      ))}
    </svg>
  );
}
