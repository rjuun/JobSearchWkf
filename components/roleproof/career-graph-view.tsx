'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { CareerGraph } from '@/lib/career-graph';
import {
  buildGraphViewModel,
  GRAPH_FOOTNOTE,
  normRef,
  type GraphNode,
  type GraphViewModel,
  type NodeType,
} from '@/lib/career-graph-view-model';

// R7 · Career Graph — the force-directed evidence map, live-wired to the real graph
// query (no mock data). Design agreed over several mockup rounds
// (docs/design/career-graph-visualization.html); ported here with D3 driving the SVG
// imperatively (simulation, drag, zoom, tick) while React state drives the chrome
// around it (legend, search, tooltip, side panel) — the two don't fight because the
// simulation's node/link objects are created once per `graph` identity and mutated in
// place by D3, never replaced by a React re-render.

type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimLink = { source: string | SimNode; target: string | SimNode; kind: 'contains' | 'evidence' | 'bullet-slot' | 'bullet-tag' | 'bullet-evidence' };

// Legend order (object key order drives render order below): Positions, then
// Responsibilities (a position-level fact, so it sits next to Positions rather
// than after the STAR cluster), then STAR stories and what piles under a story
// — Actions/Results together, then Competences/Attributes/Skills together.
const TYPE_META: Record<NodeType, { label: string; color: string; rect?: boolean }> = {
  position: { label: 'Positions', color: 'rgb(30 58 138)' },
  responsibility: { label: 'Responsibilities', color: 'rgb(100 116 139)' },
  star: { label: 'STAR stories', color: 'rgb(13 148 136)' },
  action: { label: 'Actions', color: 'rgb(22 163 74)' },
  result: { label: 'Results', color: 'rgb(234 88 12)' },
  competence: { label: 'Competences', color: 'rgb(124 58 237)' },
  attribute: { label: 'Attributes', color: 'rgb(219 39 119)' },
  skill: { label: 'Skills', color: 'rgb(180 83 9)' },
  bullet: { label: 'CV Bullets', color: 'rgb(190 18 60)', rect: true },
};
const NODE_FILL: Record<NodeType, string> = {
  position: 'rgb(30 58 138)',
  star: '#fff',
  action: 'rgb(22 163 74 / .18)',
  result: 'rgb(234 88 12 / .18)',
  responsibility: 'rgb(100 116 139 / .18)',
  competence: 'rgb(124 58 237 / .18)',
  attribute: 'rgb(219 39 119 / .18)',
  skill: 'rgb(180 83 9 / .18)',
  bullet: 'rgb(190 18 60 / .12)',
};
const NODE_STROKE: Record<NodeType, string> = {
  position: 'rgb(20 38 94)',
  star: 'rgb(13 148 136)',
  action: 'rgb(22 163 74)',
  result: 'rgb(234 88 12)',
  responsibility: 'rgb(100 116 139)',
  competence: 'rgb(124 58 237)',
  attribute: 'rgb(219 39 119)',
  skill: 'rgb(180 83 9)',
  bullet: 'rgb(190 18 60)',
};
const LEGEND_PX: Record<NodeType, number> = { position: 17, star: 13, responsibility: 11, action: 9, result: 9, competence: 6.5, attribute: 6.5, skill: 6.5, bullet: 9 };
// Legend grouping — pills related types together rather than showing 9 loose
// buttons: Actions+Results (what piles directly under a STAR) get one pill, and
// Competences+Attributes+Skills get another — the three are visually distinct
// node types but are meant to read as one "Skills" family for CV-tailoring
// purposes (per the size-code caption below the toolbar). Positions,
// Responsibilities, STAR stories and CV Bullets each stay their own single-item
// group. Each item inside a pill still toggles independently.
const LEGEND_GROUPS: NodeType[][] = [['position'], ['responsibility'], ['star'], ['action', 'result'], ['competence', 'attribute', 'skill'], ['bullet']];
const SIZE_TIER: Record<NodeType, number> = { position: 20, star: 12, responsibility: 6.5, action: 4.5, result: 4.5, competence: 3, attribute: 3, skill: 3, bullet: 0 };
const CHARGE: Partial<Record<NodeType, number>> = { position: -950, star: -170, skill: -22, result: -15, responsibility: -22, action: -13, competence: -13, attribute: -13, bullet: -70 };
const RING_DIST: Record<string, number> = {
  'position>star': 78,
  'position>responsibility': 34,
  'star>action': 20,
  'star>result': 44,
  'star>competence': 24,
  'star>attribute': 24,
};
const BULLET_W = 40;
const BULLET_H = 20;
const BULLET_RADIUS = Math.hypot(BULLET_W, BULLET_H) / 2;
SIZE_TIER.bullet = BULLET_RADIUS;

function nodeRadius(d: SimNode) {
  return SIZE_TIER[d.type] ?? 5;
}
function edgeKey(l: { source: SimNode; target: SimNode }) {
  return `${l.source.type}>${l.target.type}`;
}
function linkDistance(l: SimLink) {
  if (l.kind === 'evidence') return 190;
  if (l.kind === 'bullet-evidence') return 50;
  if (l.kind === 'bullet-slot') return 60;
  if (l.kind === 'bullet-tag') return 46;
  const s = l.source as SimNode;
  const t = l.target as SimNode;
  return RING_DIST[`${s.type}>${t.type}`] ?? 30;
}
function linkStrength(l: SimLink) {
  if (l.kind === 'evidence') return 0.12;
  if (l.kind === 'bullet-evidence') return 0.8;
  if (l.kind === 'bullet-slot') return 0.75;
  if (l.kind === 'bullet-tag') return 0.55;
  const s = l.source as SimNode;
  const t = l.target as SimNode;
  return `${s.type}>${t.type}` === 'position>star' ? 0.85 : 1;
}
// bullet-evidence (confirmed, real per-bullet source) reads as the strongest, most solid
// bullet link — same hue as bullet-tag (an inference) but thicker and never dashed, so a
// glance tells "confirmed source" apart from "tag-matched skill" apart from bullet-slot's
// faded, dashed "unconfirmed, slot-level guess".
const LINK_STYLE: Record<SimLink['kind'], { stroke: string; width: number; dash: string | null; opacity: number }> = {
  contains: { stroke: 'rgb(230 225 215)', width: 1.1, dash: null, opacity: 1 },
  evidence: { stroke: 'rgb(180 83 9)', width: 1.1, dash: '2,2', opacity: 0.5 },
  'bullet-evidence': { stroke: 'rgb(190 18 60)', width: 1.8, dash: null, opacity: 1 },
  'bullet-tag': { stroke: 'rgb(190 18 60)', width: 1.5, dash: null, opacity: 0.8 },
  'bullet-slot': { stroke: 'rgb(190 18 60 / .45)', width: 1.1, dash: '1,3', opacity: 1 },
};

function tooltipContent(d: GraphNode, vm: GraphViewModel): [string, string] {
  switch (d.type) {
    case 'position': {
      const p = d.data as CareerGraph['positions'][number];
      return [p.title ?? '', [p.company, [p.startDate, p.endDate].filter(Boolean).join('–')].filter(Boolean).join(' · ')];
    }
    case 'star': {
      const s = d.data as CareerGraph['stars'][number];
      const p = s.positionRef ? [...vm.positionById.values()].find((x) => normRef(x.refCode) === normRef(s.positionRef)) : undefined;
      return [d.label, p?.title ?? ''];
    }
    case 'action': {
      const a = d.data as CareerGraph['actions'][number];
      const s = a.starRef ? [...vm.starById.values()].find((x) => normRef(x.refCode) === normRef(a.starRef)) : undefined;
      return [d.label, `Action · ${s?.title ?? ''}`];
    }
    case 'result': {
      const r = d.data as CareerGraph['results'][number];
      const s = r.starRef ? [...vm.starById.values()].find((x) => normRef(x.refCode) === normRef(r.starRef)) : undefined;
      return [d.label, [r.metric, s?.title].filter(Boolean).join(' · ')];
    }
    case 'responsibility':
      return [d.label, 'Responsibility'];
    case 'competence': {
      const data = d.data as { starIds: string[] };
      const n = data.starIds.length;
      return [d.label, n > 1 ? `Competence · ${n} stories` : 'Competence · 1 story'];
    }
    case 'attribute': {
      const data = d.data as { starIds: string[] };
      const n = data.starIds.length;
      return [d.label, n > 1 ? `Attribute · ${n} stories` : 'Attribute · 1 story'];
    }
    case 'skill': {
      const sk = d.data as CareerGraph['skills'][number];
      return [d.label, sk.proficiency ? `Skill · ${sk.proficiency}` : 'Skill'];
    }
    case 'bullet': {
      const b = d.data as CareerGraph['bullets'][number];
      const t = b.text ?? '';
      return [t.length > 110 ? t.slice(0, 108) + '…' : t, `CV Bullet${b.cvPosition ? ' · ' + b.cvPosition : ''}`];
    }
    default:
      return [d.label, ''];
  }
}

export function CareerGraphView({ graph }: { graph: CareerGraph }) {
  const vm = useMemo(() => buildGraphViewModel(graph), [graph]);

  // CI-037's original design for this overlay: bullets stay hidden until the legend is
  // clicked, and once they're on, the graph shows ONLY bullets and their direct
  // connections — not bullets dropped on top of the full hierarchy (a hairball where a
  // bullet's real evidence link is indistinguishable from the unrelated structural
  // 'contains' backbone around it). "Direct connection" means one hop via an actual
  // bullet edge (bullet-evidence, bullet-slot, bullet-tag) — not the transitive
  // hierarchy above it (e.g. a cited STAR's own position doesn't reappear just because
  // the STAR did).
  const bulletConnectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of vm.links) {
      if (l.kind === 'bullet-evidence' || l.kind === 'bullet-slot' || l.kind === 'bullet-tag') {
        ids.add(l.source);
        ids.add(l.target);
      }
    }
    return ids;
  }, [vm]);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeSelRef = useRef<d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null);
  const linkSelRef = useRef<d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const fitTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  const [visible, setVisible] = useState<Record<NodeType, boolean>>({
    position: true, star: true, action: true, result: true, responsibility: true, competence: true, attribute: true, skill: true, bullet: false,
  });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ node: GraphNode; x: number; y: number } | null>(null);

  function jumpTo(id: string) {
    const n = vm.byId.get(id);
    if (n) setSelected(n);
  }

  // ---------- build the simulation once per graph identity ----------
  useEffect(() => {
    const svgEl = svgRef.current;
    const container = containerRef.current;
    if (!svgEl || !container) return;

    const nodes: SimNode[] = vm.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = vm.links.map((l) => ({ ...l }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    let width = container.clientWidth || 900;
    const height = 760;

    const g = svg.append('g');
    const linkLayer = g.append('g');
    const nodeLayer = g.append('g');

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.25, 4]).on('zoom', (ev) => g.attr('transform', ev.transform.toString()));
    svg.call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    // Smooth incremental wheel zoom — see build_career_graph.py for the rationale
    // (a physical mouse wheel's big notches read as jumpy under d3's default handler).
    svg.on('wheel.zoom', null);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svgEl.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const t = d3.zoomTransform(svgEl);
      const factor = Math.pow(1.0018, -event.deltaY);
      const [kMin, kMax] = zoomBehavior.scaleExtent();
      const newK = Math.max(kMin, Math.min(kMax, t.k * factor));
      const newT = d3.zoomIdentity.translate(cx - (cx - t.x) * (newK / t.k), cy - (cy - t.y) * (newK / t.k)).scale(newK);
      svg.transition().duration(160).ease(d3.easeCubicOut).call(zoomBehavior.transform, newT);
    };
    svgEl.addEventListener('wheel', onWheel, { passive: false });

    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(linkDistance)
          .strength(linkStrength)
      )
      .force('charge', d3.forceManyBody<SimNode>().strength((d) => CHARGE[d.type] ?? -30))
      .force('collide', d3.forceCollide<SimNode>().radius((d) => nodeRadius(d) + (d.type === 'position' || d.type === 'star' ? 6 : 2)))
      .force('x', d3.forceX(width / 2).strength(0.018))
      .force('y', d3.forceY(height / 2).strength(0.018));
    simRef.current = simulation;

    const linkSel = linkLayer
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) => LINK_STYLE[d.kind].stroke)
      .attr('stroke-width', (d) => LINK_STYLE[d.kind].width)
      .attr('stroke-dasharray', (d) => LINK_STYLE[d.kind].dash)
      .attr('opacity', (d) => LINK_STYLE[d.kind].opacity)
      .attr('fill', 'none');
    linkSelRef.current = linkSel;

    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (ev, d) => {
        if (!ev.active) simulation.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (ev, d) => {
        d.fx = ev.x;
        d.fy = ev.y;
      })
      .on('end', (ev, d) => {
        if (!ev.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const nodeSel = nodeLayer
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(drag)
      .on('click', (ev, d) => {
        ev.stopPropagation();
        jumpTo(d.id);
      })
      .on('mouseenter', (ev, d) => {
        setHoveredId(d.id);
        setTooltip({ node: d, x: ev.clientX, y: ev.clientY });
      })
      .on('mousemove', (ev) => {
        setTooltip((t) => (t ? { ...t, x: ev.clientX, y: ev.clientY } : t));
      })
      .on('mouseleave', () => {
        setHoveredId(null);
        setTooltip(null);
      });
    nodeSelRef.current = nodeSel;

    nodeSel.each(function (d) {
      const sel = d3.select(this);
      if (d.type === 'bullet') {
        sel
          .append('rect')
          .attr('x', -BULLET_W / 2)
          .attr('y', -BULLET_H / 2)
          .attr('width', BULLET_W)
          .attr('height', BULLET_H)
          .attr('rx', 5)
          .attr('fill', NODE_FILL.bullet)
          .attr('stroke', NODE_STROKE.bullet)
          .attr('stroke-width', 1.5);
      } else {
        sel
          .append('circle')
          .attr('r', nodeRadius(d))
          .attr('fill', NODE_FILL[d.type])
          .attr('stroke', NODE_STROKE[d.type])
          .attr('stroke-width', d.type === 'star' ? 2.25 : d.type === 'position' ? 1.5 : 1.1);
      }
    });

    nodeSel
      .filter((d) => d.type === 'position' || d.type === 'star')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => -nodeRadius(d) - 6)
      .attr('font-size', 11.5)
      .attr('font-weight', 700)
      .attr('fill', 'rgb(27 26 23)')
      .style('pointer-events', 'none')
      .text((d) => (d.label.length > 34 ? d.label.slice(0, 32) + '…' : d.label));

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    function fitToView(animate: boolean) {
      const shown = nodes.filter((n) => visible[n.type]);
      if (!shown.length) return;
      const pad = 40;
      const xs = shown.map((n) => n.x ?? 0);
      const ys = shown.map((n) => n.y ?? 0);
      const x0 = Math.min(...xs) - pad;
      const x1 = Math.max(...xs) + pad;
      const y0 = Math.min(...ys) - pad;
      const y1 = Math.max(...ys) + pad;
      const bw = x1 - x0;
      const bh = y1 - y0;
      const scale = Math.max(0.25, Math.min(2, 0.96 / Math.max(bw / width, bh / height)));
      const tx = width / 2 - (scale * (x0 + x1)) / 2;
      const ty = height / 2 - (scale * (y0 + y1)) / 2;
      const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
      fitTransformRef.current = t;
      (animate ? svg.transition().duration(500) : svg).call(zoomBehavior.transform as never, t);
    }
    simulation.on('end', () => fitToView(true));

    function applyVisibility() {
      nodeSel.style('display', (d) => (visible[d.type] ? null : 'none'));
      linkSel.style('display', (l) => {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        return visible[s.type] && visible[t.type] ? null : 'none';
      });
    }
    applyVisibility();

    svg.on('click', () => setSelected(null));

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (!w || w === width) return;
      width = w;
      simulation.force('x', d3.forceX(width / 2).strength(0.018));
      simulation.force('y', d3.forceY(height / 2).strength(0.018));
      fitToView(true);
    });
    resizeObserver.observe(container);

    return () => {
      svgEl.removeEventListener('wheel', onWheel);
      resizeObserver.disconnect();
      simulation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm]);

  // ---------- visibility toggle (legend) ----------
  useEffect(() => {
    const nodeSel = nodeSelRef.current;
    const linkSel = linkSelRef.current;
    if (!nodeSel || !linkSel) return;
    // A node's own type toggle always applies. On top of that, once CV Bullets is on,
    // every non-bullet node also needs a direct bullet edge to stay visible — this is
    // what turns "bullets overlaid on the full graph" into "just the bullet
    // neighborhood" per CI-037's original design.
    const nodeVisible = (d: SimNode) => {
      if (!visible[d.type]) return false;
      if (visible.bullet && d.type !== 'bullet' && !bulletConnectedIds.has(d.id)) return false;
      return true;
    };
    nodeSel.style('display', (d) => (nodeVisible(d) ? null : 'none'));
    const isBulletLinkKind = (k: SimLink['kind']) => k === 'bullet-evidence' || k === 'bullet-slot' || k === 'bullet-tag';
    linkSel.style('display', (l) => {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      if (!nodeVisible(s) || !nodeVisible(t)) return 'none';
      // In bullet-isolate mode, a structural `contains`/`evidence` edge between two
      // otherwise-visible nodes must still be suppressed unless it's itself a bullet
      // edge — two nodes can each be visible because of DIFFERENT bullets, and showing
      // the incidental edge between them would misread as one bullet's real connection.
      if (visible.bullet && !isBulletLinkKind(l.kind)) return 'none';
      return null;
    });
  }, [visible, bulletConnectedIds]);

  // ---------- highlight: search takes priority, then selection, then hover ----------
  useEffect(() => {
    const nodeSel = nodeSelRef.current;
    const linkSel = linkSelRef.current;
    if (!nodeSel || !linkSel) return;

    const q = search.trim().toLowerCase();
    if (q) {
      const matched = new Set(
        vm.nodes.filter((n) => n.label.toLowerCase().includes(q) || (n.type === 'skill' && ((n.data as CareerGraph['skills'][number]).atsKeywordVariants ?? []).some((v) => v.toLowerCase().includes(q)))).map((n) => n.id)
      );
      nodeSel.style('opacity', (d) => (matched.has(d.id) ? 1 : 0.12));
      linkSel.style('opacity', null).style('opacity', 0.05);
      return;
    }

    const anchor = selected?.id ?? hoveredId;
    if (!anchor) {
      nodeSel.style('opacity', 1);
      linkSel.style('opacity', null);
      return;
    }
    const neighbors = new Set<string>([anchor]);
    for (const l of vm.links) {
      const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      if (s === anchor) neighbors.add(t);
      if (t === anchor) neighbors.add(s);
    }
    nodeSel.style('opacity', (d) => (neighbors.has(d.id) ? 1 : 0.12));
    linkSel.style('opacity', (l) => {
      const s = typeof l.source === 'string' ? l.source : (l.source as SimNode).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as SimNode).id;
      return s === anchor || t === anchor ? 0.95 : 0.05;
    });
  }, [search, selected, hoveredId, vm]);

  function resetView() {
    setSearch('');
    setSelected(null);
    const zoomBehavior = zoomRef.current;
    const svgEl = svgRef.current;
    if (zoomBehavior && svgEl) {
      d3.select(svgEl).transition().duration(400).call(zoomBehavior.transform as never, fitTransformRef.current);
    }
  }

  return (
    <div className="mt-5 rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <div className="flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">Your evidence, mapped</div>
          <h2 className="mt-0.5 font-serif text-[24px] leading-none text-ink">Career Graph</h2>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:w-auto">
          <MiniStat label="Positions" value={vm.stats.positions} />
          <MiniStat label="Stories" value={vm.stats.stars} />
          <MiniStat label="Quantified" value={`${vm.stats.quantifiedResults}/${vm.stats.totalResults}`} accent />
          <MiniStat
            label="ATS skills (+Comp/Attr)"
            value={`${vm.stats.skillsWithAts}/${vm.stats.totalSkills + vm.stats.totalCompetences + vm.stats.totalAttributes}`}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-2.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search positions, stories, skills…"
          className="min-w-[180px] flex-1 rounded-field border border-hairline bg-raised px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-subtle"
        />
        <div className="flex flex-wrap items-center gap-2">
          {LEGEND_GROUPS.map((group) => (
            <div
              key={group.join('-')}
              className={group.length > 1 ? 'flex items-center gap-2.5 rounded-full border border-hairline bg-raised px-2.5 py-1' : 'contents'}
            >
              {group.map((key) => {
                const meta = TYPE_META[key];
                const px = LEGEND_PX[key];
                const on = visible[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}
                    className={`flex items-center gap-1.5 text-[11.5px] font-medium text-ink-muted transition ${on ? '' : 'opacity-35'} ${key === 'bullet' ? 'font-bold' : ''}`}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        background: meta.color,
                        width: meta.rect ? px * 1.8 : px,
                        height: px,
                        borderRadius: meta.rect ? 3 : 999,
                      }}
                    />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={resetView}
          className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition hover:bg-raised hover:text-ink"
        >
          Reset view
        </button>
      </div>
      <div className="border-b border-hairline px-4 py-2 text-[11px] text-ink-subtle">
        Dot size = evidence granularity, not color: Position → Responsibilities → STAR stories → Actions / Results → Competences · Attributes · Skills.
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_340px]">
        <div ref={containerRef} className="relative overflow-hidden">
          <svg ref={svgRef} width="100%" height={760} style={{ display: 'block', cursor: 'grab' }} />
          {tooltip && (
            <div
              className="pointer-events-none absolute z-30 max-w-[270px] rounded-lg bg-ink px-3 py-2 text-paper shadow-lg"
              style={{ left: 0, top: 0, transform: `translate(${tooltip.x - (containerRef.current?.getBoundingClientRect().left ?? 0) + 16}px, ${tooltip.y - (containerRef.current?.getBoundingClientRect().top ?? 0) + 16}px)` }}
            >
              <div className="text-[12.5px] font-bold leading-snug">{tooltipContent(tooltip.node, vm)[0]}</div>
              {tooltipContent(tooltip.node, vm)[1] && <div className="mt-0.5 text-[11px] text-ink-subtle">{tooltipContent(tooltip.node, vm)[1]}</div>}
            </div>
          )}
        </div>

        <aside className="border-t border-hairline p-5 lg:border-l lg:border-t-0">
          {selected ? (
            <SidePanel node={selected} vm={vm} onJump={jumpTo} />
          ) : (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-proof-deep">Map the evidence</div>
              <h3 className="mt-2 font-serif text-[22px] leading-none text-ink">Select any node</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                Positions are the big hubs. Each STAR breaks down into its own actions and results, plus the competences, attributes and skills it
                demonstrates. The dashed lines are skill evidence. Click through to see the full record.
              </p>
            </div>
          )}
        </aside>
      </div>

      <div className="border-t border-hairline px-4 py-3 text-[11.5px] leading-relaxed text-ink-subtle">{GRAPH_FOOTNOTE}</div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-[9px] border border-hairline bg-raised px-3 py-2 text-center">
      <div className={`font-serif text-[20px] leading-none tabular-nums ${accent ? 'text-proof' : 'text-ink'}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-ink-subtle">{label}</div>
    </div>
  );
}

function Kicker({ type, children }: { type: NodeType; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.09em]"
      style={{ background: `${NODE_STROKE[type]} / 0.14`, color: NODE_STROKE[type] }}
    >
      {children}
    </span>
  );
}

function Chip({ onClick, tone, children, title }: { onClick?: () => void; tone?: 'amber'; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
        tone === 'amber' ? 'border-caution-ring bg-caution-soft text-caution-deep' : 'border-hairline bg-raised text-ink-muted'
      } ${onClick ? 'cursor-pointer transition hover:border-proof-ring hover:bg-proof-soft hover:text-proof-deep' : ''}`}
    >
      {children}
    </span>
  );
}

function SectionH({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">{children}</div>;
}

function SidePanel({ node, vm, onJump }: { node: GraphNode; vm: GraphViewModel; onJump: (id: string) => void }) {
  switch (node.type) {
    case 'position': {
      const p = node.data as CareerGraph['positions'][number];
      const stars = vm.starsByPositionId.get(p.id) ?? [];
      const resp = vm.respByPositionId.get(p.id) ?? [];
      return (
        <div>
          <Kicker type="position">Position · {p.refCode}</Kicker>
          <h2 className="mt-2.5 font-serif text-[22px] leading-tight text-ink">{p.title}</h2>
          <div className="mt-1 text-[12.5px] text-ink-subtle">
            {[p.company, [p.startDate, p.endDate].filter(Boolean).join('–')].filter(Boolean).join(' · ')}
          </div>
          {p.summary && <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{p.summary}</p>}
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>STAR stories ({stars.length})</SectionH>
            <div className="flex flex-wrap gap-1.5">
              {stars.length ? stars.map((s) => <Chip key={s.id} onClick={() => onJump(`star-${s.id}`)}>{s.title}</Chip>) : <span className="text-[12.5px] text-ink-subtle">None yet.</span>}
            </div>
          </div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>Responsibilities ({resp.length})</SectionH>
            <ul className="flex flex-col gap-1.5">
              {resp.length ? (
                resp.map((r) => (
                  <li key={r.id} className="cursor-pointer text-[13px] text-ink transition hover:text-proof-deep" onClick={() => onJump(`resp-${r.id}`)}>
                    → {r.text}
                  </li>
                ))
              ) : (
                <span className="text-[12.5px] text-ink-subtle">None yet.</span>
              )}
            </ul>
          </div>
        </div>
      );
    }
    case 'star': {
      const s = node.data as CareerGraph['stars'][number];
      const p = s.positionRef ? [...vm.positionById.values()].find((x) => normRef(x.refCode) === normRef(s.positionRef)) : undefined;
      const acts = vm.actionsByStarId.get(s.id) ?? [];
      const res = vm.resultsByStarId.get(s.id) ?? [];
      const comps = vm.competencesByStarId.get(s.id) ?? [];
      const attrs = vm.attributesByStarId.get(s.id) ?? [];
      const skills = vm.skillsByStarId.get(s.id) ?? [];
      return (
        <div>
          <Kicker type="star">STAR{p ? ` · ${p.title}` : ''}</Kicker>
          <h2 className="mt-2.5 font-serif text-[22px] leading-tight text-ink">{s.title}</h2>
          {s.summary && (
            <div className="mt-3 border-t border-hairline pt-3.5">
              <SectionH>Summary</SectionH>
              <p className="text-[13px] leading-relaxed text-ink-muted">{s.summary}</p>
            </div>
          )}
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>Actions ({acts.length})</SectionH>
            <ul className="flex flex-col gap-1.5">
              {acts.map((a) => (
                <li key={a.id} className="cursor-pointer text-[13px] text-ink transition hover:text-proof-deep" onClick={() => onJump(`act-${a.id}`)}>
                  → {a.text}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>Results ({res.length})</SectionH>
            <ul className="flex flex-col gap-1.5">
              {res.map((r) => (
                <li key={r.id} className="cursor-pointer text-[13px] text-ink transition hover:text-proof-deep" onClick={() => onJump(`res-${r.id}`)}>
                  → {r.text}
                  {r.metric && <span className="ml-1.5 rounded-full bg-caution-soft px-1.5 py-0.5 text-[10.5px] font-bold text-caution-deep">{r.metric}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>Competences ({comps.length})</SectionH>
            <div className="flex flex-wrap gap-1.5">
              {comps.length ? comps.map((c) => <Chip key={c.name} onClick={() => onJump(`comp-${slugify(c.name)}`)}>{c.name}</Chip>) : <span className="text-[12.5px] text-ink-subtle">None logged.</span>}
            </div>
          </div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>Attributes ({attrs.length})</SectionH>
            <div className="flex flex-wrap gap-1.5">
              {attrs.length ? attrs.map((a) => <Chip key={a.name} onClick={() => onJump(`attr-${slugify(a.name)}`)}>{a.name}</Chip>) : <span className="text-[12.5px] text-ink-subtle">None logged.</span>}
            </div>
          </div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>Evidences these skills ({skills.length})</SectionH>
            <div className="flex flex-wrap gap-1.5">
              {skills.length ? skills.map((sk) => <Chip key={sk.id} tone="amber" onClick={() => onJump(`skill-${sk.id}`)}>{sk.skill}</Chip>) : <span className="text-[12.5px] text-ink-subtle">None mapped.</span>}
            </div>
          </div>
          {p && (
            <button type="button" onClick={() => onJump(`pos-${p.id}`)} className="mt-4 text-[12px] font-semibold text-proof-deep hover:underline">
              ← Back to {p.title}
            </button>
          )}
        </div>
      );
    }
    case 'action': {
      const a = node.data as CareerGraph['actions'][number];
      const s = a.starRef ? [...vm.starById.values()].find((x) => normRef(x.refCode) === normRef(a.starRef)) : undefined;
      return (
        <div>
          <Kicker type="action">Action</Kicker>
          <h2 className="mt-2.5 font-serif text-[19px] leading-snug text-ink">{a.text}</h2>
          <div className="mt-1 text-[12.5px] text-ink-subtle">{s?.title}</div>
          {(a.skills ?? []).length > 0 && (
            <div className="mt-4 border-t border-hairline pt-3.5">
              <SectionH>Skills demonstrated</SectionH>
              <div className="flex flex-wrap gap-1.5">
                {(a.skills ?? []).map((v, i) => (
                  <Chip key={i}>{v}</Chip>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] italic text-ink-subtle">Free text from this action's record — not yet matched to a Skill in your master list.</p>
            </div>
          )}
          {(a.atsKeywords ?? []).length > 0 && (
            <div className="mt-4 border-t border-hairline pt-3.5">
              <SectionH>ATS keywords</SectionH>
              <div className="flex flex-wrap gap-1.5">
                {(a.atsKeywords ?? []).map((v, i) => (
                  <Chip key={i}>{v}</Chip>
                ))}
              </div>
            </div>
          )}
          {s && (
            <button type="button" onClick={() => onJump(`star-${s.id}`)} className="mt-4 text-[12px] font-semibold text-proof-deep hover:underline">
              ← Back to {s.title}
            </button>
          )}
        </div>
      );
    }
    case 'result': {
      const r = node.data as CareerGraph['results'][number];
      const s = r.starRef ? [...vm.starById.values()].find((x) => normRef(x.refCode) === normRef(r.starRef)) : undefined;
      return (
        <div>
          <Kicker type="result">Result{r.impactType ? ` · ${r.impactType}` : ''}</Kicker>
          <h2 className="mt-2.5 font-serif text-[19px] leading-snug text-ink">{r.text}</h2>
          <div className="mt-1 text-[12.5px] text-ink-subtle">{s?.title}</div>
          {r.metric && (
            <div className="mt-4 border-t border-hairline pt-3.5">
              <SectionH>Quantified</SectionH>
              <Chip tone="amber">{r.metric}</Chip>
            </div>
          )}
          {s && (
            <button type="button" onClick={() => onJump(`star-${s.id}`)} className="mt-4 text-[12px] font-semibold text-proof-deep hover:underline">
              ← Back to {s.title}
            </button>
          )}
        </div>
      );
    }
    case 'responsibility': {
      const r = node.data as CareerGraph['responsibilities'][number];
      const p = r.positionRef ? [...vm.positionById.values()].find((x) => normRef(x.refCode) === normRef(r.positionRef)) : undefined;
      return (
        <div>
          <Kicker type="responsibility">Responsibility</Kicker>
          <h2 className="mt-2.5 font-serif text-[19px] leading-snug text-ink">{r.text}</h2>
          <div className="mt-1 text-[12.5px] text-ink-subtle">{p?.title}</div>
          {(r.skills ?? []).length > 0 && (
            <div className="mt-4 border-t border-hairline pt-3.5">
              <SectionH>Skills</SectionH>
              <div className="flex flex-wrap gap-1.5">
                {(r.skills ?? []).map((v, i) => (
                  <Chip key={i}>{v}</Chip>
                ))}
              </div>
            </div>
          )}
          {p && (
            <button type="button" onClick={() => onJump(`pos-${p.id}`)} className="mt-4 text-[12px] font-semibold text-proof-deep hover:underline">
              ← Back to {p.title}
            </button>
          )}
        </div>
      );
    }
    case 'competence':
    case 'attribute': {
      const data = node.data as { name: string; starIds: string[] };
      return (
        <div>
          <Kicker type={node.type}>{node.type === 'competence' ? 'Competence' : 'Attribute'}</Kicker>
          <h2 className="mt-2.5 font-serif text-[21px] leading-tight text-ink">{data.name}</h2>
          <div className="mt-1 text-[12.5px] text-ink-subtle">
            Demonstrated in {data.starIds.length} {data.starIds.length === 1 ? 'story' : 'stories'}
          </div>
          <div className="mt-4 flex flex-col gap-2 border-t border-hairline pt-3.5">
            {data.starIds.map((sid) => {
              const s = vm.starById.get(sid);
              if (!s) return null;
              return (
                <button key={sid} type="button" onClick={() => onJump(`star-${sid}`)} className="text-left text-[12.5px] font-semibold text-proof-deep hover:underline">
                  {s.title}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case 'skill': {
      const sk = node.data as CareerGraph['skills'][number];
      // Resolved by the view-model, not re-parsed here — `starEvidence` entries are free
      // text ("STAR 4", "All senior STARs"), not clean ref codes; the parsing lives in one
      // place (`lib/career-graph-view-model.ts`) so this panel can't drift from the graph.
      const evidenceStars = vm.starsBySkillId.get(sk.id) ?? [];
      return (
        <div>
          <Kicker type="skill">Skill</Kicker>
          <h2 className="mt-2.5 font-serif text-[21px] leading-tight text-ink">{sk.skill}</h2>
          <div className="mt-1 text-[12.5px] text-ink-subtle">{sk.proficiency ? `Proficiency: ${sk.proficiency}` : ''}</div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>ATS keyword variants</SectionH>
            <div className="flex flex-wrap gap-1.5">
              {(sk.atsKeywordVariants ?? []).length ? (sk.atsKeywordVariants ?? []).map((v, i) => <Chip key={i}>{v}</Chip>) : <span className="text-[12.5px] text-ink-subtle">None yet — a gap the coach would flag.</span>}
            </div>
          </div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>
              Evidenced by ({evidenceStars.length} STAR{evidenceStars.length === 1 ? '' : 's'})
            </SectionH>
            <div className="flex flex-wrap gap-1.5">
              {evidenceStars.map((s) => (
                <Chip key={s.id} onClick={() => onJump(`star-${s.id}`)}>{s.title}</Chip>
              ))}
            </div>
          </div>
        </div>
      );
    }
    case 'bullet': {
      const b = node.data as CareerGraph['bullets'][number];
      // Resolved by the view-model, not re-parsed here — same one-parsing-path rationale
      // as the 'skill' case above: `cvPosition` holds a CV_SLOTS slot code, and the
      // slot→STAR / slot→Responsibilities / bullet_evidence resolution lives in one place
      // (lib/career-graph-view-model.ts) so this panel can't drift from what the graph draws.
      const confirmedEvidence = vm.evidenceNodesByBulletId.get(b.id) ?? [];
      const matchedStar = vm.starByBulletId.get(b.id);
      const matchedResps = vm.respByBulletId.get(b.id) ?? [];
      const matchedSkills = (b.tags ?? [])
        .map((tag) => [...vm.byId.values()].find((n) => n.type === 'skill' && (n.data as CareerGraph['skills'][number]).skill?.trim().toLowerCase() === tag.trim().toLowerCase()))
        .filter((n): n is GraphNode => !!n);
      return (
        <div>
          <Kicker type="bullet">CV Bullet{b.cvPosition ? ` · ${b.cvPosition}` : ''}</Kicker>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink">{b.text}</p>
          <div className="mt-2 text-[12.5px] text-ink-subtle">
            {confirmedEvidence.length > 0 ? (
              <>
                Built from {confirmedEvidence.length} confirmed evidence row{confirmedEvidence.length === 1 ? '' : 's'}:{' '}
                {confirmedEvidence.map((n, i) => (
                  <span key={n.id}>
                    {i > 0 && ', '}
                    <button type="button" onClick={() => onJump(n.id)} className="font-semibold text-proof-deep hover:underline">
                      {n.label}
                    </button>
                  </span>
                ))}
              </>
            ) : matchedStar ? (
              <>
                No confirmed source yet — best guess from its CV slot:{' '}
                <button type="button" onClick={() => onJump(`star-${matchedStar.id}`)} className="font-semibold text-proof-deep hover:underline">
                  {matchedStar.title}
                </button>
              </>
            ) : matchedResps.length > 0 ? (
              <>
                No confirmed source yet — rolls up {matchedResps.length} Responsibilit{matchedResps.length === 1 ? 'y' : 'ies'} under its CV slot, incl.{' '}
                <button type="button" onClick={() => onJump(`resp-${matchedResps[0].id}`)} className="font-semibold text-proof-deep hover:underline">
                  {matchedResps[0].text?.slice(0, 60)}
                  {(matchedResps[0].text?.length ?? 0) > 60 ? '…' : ''}
                </button>
              </>
            ) : (
              'No CV-slot link recorded for this bullet (e.g. the Overarching Skills bullet, which isn’t tied to a position).'
            )}
          </div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>Tags</SectionH>
            <div className="flex flex-wrap gap-1.5">
              {(b.tags ?? []).length ? (b.tags ?? []).map((t, i) => <Chip key={i}>{t}</Chip>) : <span className="text-[12.5px] text-ink-subtle">None.</span>}
            </div>
          </div>
          <div className="mt-4 border-t border-hairline pt-3.5">
            <SectionH>Matched skills ({matchedSkills.length})</SectionH>
            {matchedSkills.length ? (
              <div className="flex flex-wrap gap-1.5">
                {matchedSkills.map((n) => (
                  <Chip key={n.id} tone="amber" onClick={() => onJump(n.id)}>{n.label}</Chip>
                ))}
              </div>
            ) : (
              <span className="text-[12.5px] text-ink-subtle">No tag exactly matched a skill name.</span>
            )}
            <p className="mt-2 text-[11.5px] italic text-ink-subtle">Inferred from this bullet's tags — not a stored source reference.</p>
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}
