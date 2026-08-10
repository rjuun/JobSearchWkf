'use client';

/**
 * The drag-and-drop capture mechanic (CI · Scoring Phase Redesign Part 2, §2.2.C).
 *
 * The first drag-and-drop surface in this app, and deliberately native HTML5 —
 * no dnd-kit, no react-dnd. There is nothing to make draggable here: the source
 * is Outlook, sitting outside the browser entirely. All this needs is a target
 * that calls preventDefault on dragover and reads dataTransfer on drop.
 *
 * Written once and used in three places: the Results "Application sent" control
 * (§2.2.H) and the decline / interview-confirm targets in the Applications list
 * (§2.2.D/E).
 *
 * Reggie drags out of two named Outlook folders (Bewerbungen / Absagen) rather
 * than the raw inbox — the mechanic doesn't care, but the copy on the targets
 * says so, because that's the gesture he actually makes.
 */
import { useCallback, useRef, useState } from 'react';
import { classifyEmailDrop, type EmailArtifactKind } from '@/lib/applications';
import { uploadEmailArtifactAction } from '@/app/actions/monitoring';

export type DropResult =
  /**
   * A file (or a link) was captured and stored — `link` goes in the DB column.
   * `emailDate`/`senderEmail` are only ever populated for a real dropped file
   * (lib/email-parse.ts read them out of it); a dropped text/uri-list link has
   * no file to parse, so both stay null.
   */
  | { kind: 'captured'; link: string; emailDate: string | null; senderEmail: string | null }
  /** Nothing usable landed: the caller opens its manual form instead. */
  | { kind: 'manual' };

export type UseEmailDrop = {
  /** Spread onto the drop target element. */
  dropProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** True while a drag is hovering — for the target's highlight state. */
  over: boolean;
  /** True while the upload + server action are in flight. */
  busy: boolean;
  error: string | null;
  /** Runs the same completion path a drop would, with no email — the manual fallback. */
  submitManual: () => void;
};

export function useEmailDrop({
  leadId,
  kind,
  onResult,
}: {
  leadId: string;
  kind: EmailArtifactKind;
  /** Given the resolved link (or nothing, for a manual confirm), do the write. */
  onResult: (result: DropResult) => void | Promise<void>;
}): UseEmailDrop {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // dragenter/dragleave fire for every child element the pointer crosses; count
  // them so moving over the target's own text doesn't flicker the highlight off.
  const depth = useRef(0);

  const finish = useCallback(
    async (result: DropResult) => {
      setBusy(true);
      setError(null);
      try {
        await onResult(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    },
    [onResult]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      if (busy) return;

      const drop = classifyEmailDrop(e.dataTransfer);
      if (drop.kind === 'none') {
        // The gesture still works — it just becomes a manual entry.
        void finish({ kind: 'manual' });
        return;
      }
      if (drop.kind === 'link') {
        // A dragged hyperlink has no file to parse — no date/sender to extract.
        void finish({ kind: 'captured', link: drop.url, emailDate: null, senderEmail: null });
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const form = new FormData();
        form.append('file', drop.file);
        const { link, emailDate, senderEmail } = await uploadEmailArtifactAction(leadId, kind, form);
        await onResult({ kind: 'captured', link, emailDate, senderEmail });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That file could not be saved.');
      } finally {
        setBusy(false);
      }
    },
    [busy, finish, kind, leadId, onResult]
  );

  return {
    over,
    busy,
    error,
    submitManual: useCallback(() => void finish({ kind: 'manual' }), [finish]),
    dropProps: {
      // Without preventDefault on dragover the browser navigates to the dropped
      // item instead of firing onDrop — the one non-obvious required line.
      onDragOver: (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragEnter: (e) => {
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop,
    },
  };
}
