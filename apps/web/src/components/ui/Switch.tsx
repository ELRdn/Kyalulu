import "./ui.css";

export default function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="k-switch" disabled={disabled} onClick={() => onChange(!checked)} />;
}
