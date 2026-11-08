import { useEffect, useRef } from 'react';
import { Gantt } from '@bryntum/gantt-community';
import '@bryntum/gantt-community/stockholm.css';
import type { Milestone } from '../api';

interface Props {
  startDate: string; // YYYY-MM-DD, Day 0
  milestones: Milestone[];
  onWarning?: (message: string) => void;
  /** Called after a drag with the names of milestones whose start date changed (cascade included). */
  onMoved?: (milestoneTitles: string[]) => void;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Bryntum Gantt (Community tier). Drag a task and its dependent tasks move with it.
 * When the Payout milestone moves, we raise a warning for the UI.
 */
export default function TimelineGantt({ startDate, milestones, onWarning, onMoved }: Props) {
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
    const tasks = milestones.map((m) => ({
      id: m.id,
      name: m.title,
      startDate: day(m.start_day),
      duration: m.start_day === m.end_day ? 0 : m.end_day - m.start_day + 1,
      durationUnit: 'day' as const,
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

    const gantt = new Gantt({
      appendTo: host.current,
      height: 280,
      viewPreset: 'weekAndDayLetter',
      project: { tasks, dependencies },
      columns: [{ type: 'name', field: 'name', width: 180 }],
      listeners: {
        afterTaskDrop: ({ source }: any) => {
          const after = payoutStart(source);
          if (lastPayout && after && lastPayout !== after) {
            warn.current?.(`Payout moved from ${lastPayout} to ${after}. Check payout timing with suppliers and buyers.`);
          }
          lastPayout = after;
          // Report every milestone whose start changed, so holds can be voided and re-booked.
          const changed: string[] = [];
          source.taskStore.forEach((t: any) => {
            const now = t.startDate ? isoDay(new Date(t.startDate)) : null;
            if (now && startsByName.get(t.name) !== now) {
              if (startsByName.has(t.name)) changed.push(t.name);
              startsByName.set(t.name, now);
            }
          });
          if (changed.length) moved.current?.(changed);
        },
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
  }, [startDate, milestones]);

  return <div ref={host} className="gantt-wrap" />;
}
