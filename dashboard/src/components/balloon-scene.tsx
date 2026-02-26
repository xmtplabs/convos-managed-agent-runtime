/**
 * Shared balloon SVG components used by both the joining animation
 * and the empty state. Extracted to avoid duplication.
 */

interface BalloonProps {
  width: number;
  height: number;
  className?: string;
}

export function BalloonSvg({ width, height, className }: BalloonProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 28 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
    >
      <path
        d="M27.7736 13.8868C27.7736 21.5563 21.5563 27.7736 13.8868 27.7736C6.21733 27.7736 0 21.5563 0 13.8868C0 6.21733 6.21733 0 13.8868 0C21.5563 0 27.7736 6.21733 27.7736 13.8868Z"
        fill="var(--color-brand)"
      />
      <path
        d="M13.8868 27.7736L18.0699 35.0189H9.70373L13.8868 27.7736Z"
        fill="var(--color-brand)"
      />
    </svg>
  );
}

export function BalloonStringUpper() {
  return (
    <svg width="20" height="40" viewBox="0 0 20 40" fill="none">
      <path
        d="M10 0 Q13 14 8 25 Q6 33 10 40"
        stroke="#D4D4D4"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BalloonStringLower() {
  return (
    <svg width="20" height="35" viewBox="0 0 20 35" fill="none">
      <path
        d="M10 0 Q14 15 8 35"
        stroke="#D4D4D4"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
