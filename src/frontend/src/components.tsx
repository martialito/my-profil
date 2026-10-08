import type { ReactNode } from 'react';

export function Field(props: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={`field${props.wide ? ' wide' : ''}`}>
      <span>{props.label}</span>
      {props.children}
      {props.hint && <small className="hint">{props.hint}</small>}
    </label>
  );
}

export function Card(props: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(props.title || props.actions) && (
        <header className="card-header">
          {props.title && <h2>{props.title}</h2>}
          <div className="actions">{props.actions}</div>
        </header>
      )}
      {props.children}
    </section>
  );
}

export function Notice(props: { kind: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  return <div className={`notice ${props.kind}`}>{props.children}</div>;
}

/** Edit a string[] as one item per line. */
export function LinesInput(props: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  return (
    <textarea
      rows={props.rows ?? 3}
      placeholder={props.placeholder}
      value={props.value.join('\n')}
      onChange={(e) => props.onChange(e.target.value.split('\n'))}
      onBlur={(e) => props.onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
    />
  );
}

/** Edit a string[] as a comma-separated list. */
export function CsvInput(props: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <input
      placeholder={props.placeholder}
      defaultValue={props.value.join(', ')}
      key={props.value.join('|')}
      onBlur={(e) => props.onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
    />
  );
}
