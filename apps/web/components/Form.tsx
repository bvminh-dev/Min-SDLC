'use client';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

export function Field({ label, error, errorTestId, field, hint, children }: { label: string; error?: string; errorTestId?: string; field?: string; hint?: string; children: (id: string, describedBy: string | undefined) => ReactNode }) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? <p id={msgId} className="field-error" role="alert" data-testid={errorTestId} data-field={field}>{error}</p> : hint ? <p id={msgId} className="hint">{hint}</p> : null}
    </div>
  );
}

/** Ô mật khẩu có nút Hiện/Ẩn (không có ô nhập lại mật khẩu, theo màn đăng ký). */
export function PasswordInput({ toggleTestId, id, describedBy, ...rest }: InputHTMLAttributes<HTMLInputElement> & { toggleTestId: string; describedBy?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input {...rest} id={id} aria-describedby={describedBy} type={show ? 'text' : 'password'} />
      <button type="button" className="btn btn-quiet" aria-pressed={show} onClick={() => setShow((s) => !s)} data-testid={toggleTestId}>{show ? 'Ẩn' : 'Hiện'}</button>
    </div>
  );
}

export const secondsText = (s?: number): string => (s ? `${s} giây` : 'ít phút');
export const minutesText = (s?: number): string => (s ? `${Math.max(1, Math.ceil(s / 60))} phút` : 'ít phút');
