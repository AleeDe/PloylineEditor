import type { LucideIcon } from 'lucide-react';

type ControlButtonProps = {
  icon: LucideIcon;
  label: string;
  shortcut: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
};

export function ControlButton({ icon: Icon, label, shortcut, active, onClick, disabled }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label} (${shortcut})`}
      className={`group min-h-12 w-full min-w-0 border-4 px-3 py-2 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 ${
        active
          ? 'border-black bg-[#FFE066] text-black ring-black dark:border-white dark:bg-[#FF6B00] dark:text-black dark:ring-white dark:ring-offset-[#101116]'
          : 'border-black bg-white text-black hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#000] dark:border-white dark:bg-[#191A23] dark:text-white dark:hover:shadow-[4px_4px_0_0_#fff]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span className="mb-1 flex min-w-0 items-center gap-2 text-sm font-black uppercase tracking-tight">
        <Icon size={17} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-xs font-semibold opacity-80">{shortcut}</span>
    </button>
  );
}
