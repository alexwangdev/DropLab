import { useEffect, useRef } from 'react';
import { Gantt } from '@bryntum/gantt-enterprise';
import '@bryntum/gantt-enterprise/stockholm.css';
import type { HoldRow, Milestone } from '../api';
import { money } from '../api';

interface Props {
  startDate: string; // YYYY-MM-DD, Day 0
  milestones: Milestone[];
  onWarning?: (message: string) => void;
  /** Called after a drag with the names of milestones whose start date changed (cascade included). */
  onMoved?: (milestoneTitles: string[]) => void;
  /** Holds from the server. Shown on each milestone bar. */
  holds?: HoldRow[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Bryntum Gantt (Community tier). Drag a task and its dependent tasks move with it.
 * When the Payout milestone moves, we raise a warning for the UI.
 */
const NO_HOLDS: HoldRow[] = [];

function holdTag(h: HoldRow): string {
  if (h.status === 'pending') return 'awaiting buyer approval';
  if (h.paypal_authorization_id) return `PayPal auth ${h.paypal_authorization_id.slice(0, 8)}…`;
  return 'simulated';
}

export default function TimelineGantt({ startDate, milestones, onWarning, onMoved, holds = NO_HOLDS }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const warn = useRef(onWarning);
  warn.current = onWarning;
  const moved = useRef(onMoved);
  moved.current = onMoved;

  useEffect(() => {
    if (!host.current) return;
    const day = (offset: number) => {
      const d = new Date(`${startDate}T00:00:00`);
      d.setDate(d.getDate() + offset);
      return isoDay(d);
    };
    // Latest active hold per milestone (a voided hold is history, not shown on the bar).
    const holdByTitle = new Map(holds.filter((h) => h.status === 'held' || h.status === 'pending').map((h) => [h.milestone_title, h]));
    const tasks = milestones.map((m) => ({
      id: m.id,
      name: m.title,
      owner: m.resource ?? '', // from the milestone record (server), not a client map
      status: m.paypal_status === 'paid' ? 'Paid' : 'Planned',
      hold: holdByTitle.get(m.title)?.amount_cents ?? null,
      startDate: day(m.start_day),
      duration: m.start_day === m.end_day ? 0 : m.end_day - m.start_day + 1,
      durationUnit: 'day' as const,
      // Baseline = the planned dates from the server, kept fixed. A drag shows the moved bar against it.
      baselines: [{ name: 'Plan', startDate: day(m.start_day), endDate: day(m.end_day + (m.start_day === m.end_day ? 0 : 1)) }],
    }));
    // Dependencies carry a lag equal to the spec gap between predecessor end and successor start.
    // Without it, Bryntum pulls each successor to its predecessor's end and the Day 2/3/6 dates are lost.
    const byId = new Map(milestones.map((m) => [m.id, m]));
    const endDay = (m: Milestone) => (m.start_day === m.end_day ? m.start_day : m.end_day + 1);
    const dependencies = milestones
      .filter((m) => m.depends_on_id)
      .map((m) => {
        const pred = byId.get(m.depends_on_id as string)!;
        return {
          id: `dep-${m.id}`,
          from: pred.id,
          to: m.id,
          lag: m.start_day - endDay(pred),
          lagUnit: 'day' as const,
        };
      });

    const payoutStart = (g: Gantt) => {
      const t = g.taskStore.find((rec: any) => rec.name === 'Payout') as any;
      return t?.startDate ? isoDay(new Date(t.startDate)) : null;
    };
    // Last known Payout date; after each drop, a changed date raises the warning.
    let lastPayout: string | null = null;
    const startsByName = new Map<string, string>();

    // One handler for every schedule change (drag or editor save). It reports the milestones whose
    // start moved, so the page can invalidate the approval and re-book holds.
    const handleScheduleChange = (source: any) => {
      const after = payoutStart(source);
      if (lastPayout && after && lastPayout !== after) {
        warn.current?.(`Payout moved from ${lastPayout} to ${after}. Check payout timing with suppliers and buyers.`);
      }
      lastPayout = after;
      const changed: string[] = [];
      source.taskStore.forEach((t: any) => {
        const now = t.startDate ? isoDay(new Date(t.startDate)) : null;
        if (now && startsByName.get(t.name) !== now) {
          if (startsByName.has(t.name)) changed.push(t.name);
          startsByName.set(t.name, now);
        }
      });
      if (changed.length) moved.current?.(changed);
    };

    const gantt = new Gantt({
      appendTo: host.current,
      height: 280,
      viewPreset: 'weekAndDayLetter',
      project: { tasks, dependencies },
      // taskEdit: double-click a task to edit its dates. Saves go through the same change handler as a drag.
      features: { criticalPaths: true, baselines: true, taskEdit: true },
      columns: [
        { type: 'name', field: 'name', width: 180 },
        { text: 'Owner', field: 'owner', width: 100 },
        { text: 'Status', field: 'status', width: 90 },
      ],
      // Hold status drawn on the bar itself (Community taskRenderer). Simulated holds are labelled.
      taskRenderer: ({ taskRecord }: any) => {
        const h = holdByTitle.get(taskRecord.name);
        const label = h ? `${taskRecord.name} · hold ${money(h.amount_cents)} · ${holdTag(h)}` : taskRecord.name;
        return { tag: 'span', text: label };
      },
      listeners: {
        afterTaskDrop: ({ source }: any) => handleScheduleChange(source),
        // Editor save (double-click) reaches the same handler: one cascade path for drag and editor.
        // The payload carries no save/cancel flag, so compare dates: only a saved edit changes them.
        afterTaskEdit: ({ source }: any) => handleScheduleChange(source),
      },
    });
    lastPayout = payoutStart(gantt);
    startsByName.clear();
    gantt.taskStore.forEach((t: any) => {
      if (t.startDate) startsByName.set(t.name, isoDay(new Date(t.startDate)));
    });

    return () => {
      gantt.destroy();
    };
  }, [startDate, milestones, holds]);

  return <div ref={host} className="gantt-wrap" />;
}
