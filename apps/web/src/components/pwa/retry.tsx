'use client';
export function Retry({label}: {label: string}) {
  return <button type="button" className="button" onClick={() => window.location.reload()}>{label}</button>;
}
