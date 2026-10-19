/**
 * Own SVG icons for Heizplan (not tado° brand assets).
 * @package @heizplan/web
 */

interface IconProps {
  className?: string;
  title?: string;
}

export function DropIcon({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path fill="currentColor" d="M12 2.4c.35 0 .65.18.85.48C15.4 6.5 18 10.4 18 13.4a6 6 0 1 1-12 0c0-3 2.6-6.9 5.15-10.52.2-.3.5-.48.85-.48z" />
    </svg>
  );
}

export function HandIcon({ className, title = "Manuell" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path fill="currentColor" d="M9.2 2.8a1.2 1.2 0 0 1 1.2 1.2v6.2h.7V5.6a1.2 1.2 0 0 1 2.4 0v4.6h.7V6.8a1.2 1.2 0 0 1 2.4 0v4.2h.6V8.7a1.2 1.2 0 0 1 2.4 0v5.8c0 3.4-2.3 6.2-5.5 7.1A5.4 5.4 0 0 1 6.2 16.5V9.4a1.2 1.2 0 0 1 2.4 0v2.6h.6V4A1.2 1.2 0 0 1 9.2 2.8z" />
    </svg>
  );
}

export function PowerIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M12 2a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm5.1 3.2a1 1 0 0 1 0 1.4 7 7 0 1 1-10.2 0 1 1 0 1 1 1.4-1.4 5 5 0 1 0 7.4 0 1 1 0 0 1 1.4 0z" />
    </svg>
  );
}

export function ScheduleResumeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M7 3a1 1 0 0 1 1 1v1h8V4a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1V4a1 1 0 0 1 1-1zm12 8H5v8h14v-8zm-3.2 1.2a1 1 0 0 1 0 1.4l-2.3 2.3H17a1 1 0 1 1 0 2h-5a1 1 0 0 1-.7-1.7l3.2-3.2a1 1 0 0 1 1.4 0z" />
    </svg>
  );
}

export function ScheduleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1zm12 8H5v9h14v-9z" />
    </svg>
  );
}

export function ReportIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M5 3h14a1 1 0 0 1 1 1v16l-4-2.5L12 20l-4-2.5L3 20V4a1 1 0 0 1 1-1zm3 10v3h2v-3H8zm3-4v7h2V9h-2zm3 2v5h2v-5h-2z" />
    </svg>
  );
}

export function HomeNavIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
    </svg>
  );
}

export function SlidersIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M4 7h10.2a2.5 2.5 0 0 0 4.6 0H20a1 1 0 1 0 0-2h-1.2a2.5 2.5 0 0 0-4.6 0H4a1 1 0 0 0 0 2zm0 6h2.2a2.5 2.5 0 0 0 4.6 0H20a1 1 0 1 0 0-2H10.8a2.5 2.5 0 0 0-4.6 0H4a1 1 0 0 0 0 2zm0 6h8.2a2.5 2.5 0 0 0 4.6 0H20a1 1 0 1 0 0-2h-3.2a2.5 2.5 0 0 0-4.6 0H4a1 1 0 0 0 0 2z" />
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M4 7a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1zm0 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1zm0 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M6.7 5.3a1 1 0 0 1 1.4 0L12 9.2l3.9-3.9a1 1 0 1 1 1.4 1.4L13.4 10.6l3.9 3.9a1 1 0 0 1-1.4 1.4L12 12l-3.9 3.9a1 1 0 0 1-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 0 1 0-1.4z" />
    </svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M14.7 5.3a1 1 0 0 1 0 1.4L9.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M9.3 6.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L13.6 12 9.3 7.7a1 1 0 0 1 0-1.4z" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M4 17.3V20h2.7l9.8-9.8-2.7-2.7L4 17.3zm14.7-8.4 1.5-1.5a1 1 0 0 0 0-1.4l-2.2-2.2a1 1 0 0 0-1.4 0l-1.5 1.5 3.6 3.6z" />
    </svg>
  );
}

export function HeatWavesIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 32" width="1em" height="1.2em" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 4c2 3 2 5 0 8s-2 5 0 8M12 2c2 3 2 5 0 8s-2 5 0 8 2 5 0 8M18 4c2 3 2 5 0 8s-2 5 0 8" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="currentColor" d="M6.3 9.3a1 1 0 0 1 1.4 0L12 13.6l4.3-4.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4z" />
    </svg>
  );
}
