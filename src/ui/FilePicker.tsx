export function FilePicker({ label, accept, disabled, onChoose }: {
  label: string; accept: string; disabled?: boolean; onChoose(file: File | undefined): void;
}) {
  return <label className="file-pick" data-disabled={disabled || undefined}>
    <input type="file" aria-label={label} accept={accept} disabled={disabled} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      onChoose(file);
    }} />
    <svg aria-hidden="true" focusable="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4m-4 4 4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>
    </svg>
    <span>{label}</span>
  </label>;
}
