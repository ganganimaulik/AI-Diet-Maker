'use client';
import { useState } from 'react';
import { BuilderChange, BuilderProposal, ProposalStatus } from '@/lib/types';

/** What a proposal card can do, supplied by the assistant view. */
export interface ProposalHandlers {
  /** Resolves '' once the change is in the builder, else the reason it is not. */
  apply: (proposal: BuilderProposal) => Promise<string>;
  reject: (proposal: BuilderProposal) => Promise<string>;
  show: (proposal: BuilderProposal) => void;
  /** Whether the Diet Builder holds edits that are not saved yet. */
  builderHasUnsavedChanges: boolean;
}

const STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: 'Needs approval',
  applied: 'Applied',
  rejected: 'Rejected'
};

/** Runs of changes to the same thing, so each meal or ingredient is named once. */
function groupChanges(changes: BuilderChange[]) {
  const groups: Array<{ where: string; changes: BuilderChange[] }> = [];
  for (const change of changes) {
    const last = groups[groups.length - 1];
    if (last && last.where === change.where) last.changes.push(change);
    else groups.push({ where: change.where, changes: [change] });
  }
  return groups;
}

function ChangeLine({ change }: { change: BuilderChange }) {
  if (change.kind === 'add') {
    return (
      <li className="proposal-change proposal-change--add">
        <span className="proposal-change__sign" aria-hidden="true">+</span>
        <span className="sr-only">Add </span>
        <ins>{change.after}</ins>
      </li>
    );
  }
  if (change.kind === 'remove') {
    return (
      <li className="proposal-change proposal-change--remove">
        <span className="proposal-change__sign" aria-hidden="true">−</span>
        <span className="sr-only">Remove </span>
        <del>{change.before}</del>
      </li>
    );
  }
  return (
    <li className="proposal-change">
      <span className="proposal-change__field">{change.field}</span>
      <span className="sr-only"> from </span>
      <del>{change.before}</del>
      <span className="proposal-change__arrow" aria-hidden="true">→</span>
      <span className="sr-only"> to </span>
      <ins>{change.after}</ins>
    </li>
  );
}

/**
 * A Diet Builder change the assistant drafted. Every value it would touch is
 * listed before → after, and nothing happens until the user presses Apply —
 * then it lands in the builder as an ordinary unsaved, undoable edit.
 */
export default function ProposalCard({ proposal, handlers }: { proposal: BuilderProposal; handlers: ProposalHandlers }) {
  const [busy, setBusy] = useState<'' | 'apply' | 'reject'>('');
  const [problem, setProblem] = useState('');
  const { status } = proposal;

  const decide = async (choice: 'apply' | 'reject') => {
    setBusy(choice);
    setProblem('');
    const reason = await handlers[choice](proposal);
    setBusy('');
    setProblem(reason);
  };

  return (
    <section className={`proposal-card proposal-card--${status}`} aria-label={`Suggested change: ${proposal.title}`}>
      <div className="proposal-card__header">
        <span className="proposal-card__eyebrow">Suggested change</span>
        <span className={`proposal-card__status proposal-card__status--${status}`}>{STATUS_LABELS[status]}</span>
      </div>
      <p className="proposal-card__title">{proposal.title}</p>
      {proposal.reason && <p className="proposal-card__reason">{proposal.reason}</p>}

      <ul className="proposal-card__groups">
        {groupChanges(proposal.changes).map((group, index) => (
          <li key={`${group.where}-${index}`}>
            <span className="proposal-card__where">{group.where}</span>
            <ul className="proposal-card__changes">
              {group.changes.map((change, changeIndex) => (
                <ChangeLine key={changeIndex} change={change} />
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {problem && <p className="proposal-card__problem" role="alert">{problem}</p>}

      {status === 'pending' && (
        <div className="proposal-card__actions">
          <button type="button" className="btn-primary" disabled={!!busy} onClick={() => decide('apply')}>
            {busy === 'apply' ? 'Applying…' : 'Apply to Diet Builder'}
          </button>
          <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => decide('reject')}>
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      )}

      {status === 'applied' && (
        <div className="proposal-card__outcome">
          {handlers.builderHasUnsavedChanges && <span>Not saved yet — Save Configuration in the builder keeps it.</span>}
          <button type="button" className="link-button" onClick={() => handlers.show(proposal)}>
            Open in Diet Builder
          </button>
        </div>
      )}

      {status === 'rejected' && <p className="proposal-card__outcome proposal-card__outcome--muted">Nothing was changed.</p>}
    </section>
  );
}
