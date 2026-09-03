export default function BrandLogo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="brand-logo" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#0b0f14" stroke="#243044" strokeWidth="1.5" />
      <g fontFamily="'Space Grotesk','Inter',sans-serif" fontWeight="700" textAnchor="middle">
        <text x="24" y="45" fontSize="30" fill="#e7edf3" transform="skewX(-8)">
          B
        </text>
        <text x="45" y="45" fontSize="30" fill="#2fd67a" transform="skewX(-8)">
          T
        </text>
      </g>
      <path
        d="M45 22 L54.5 12.5 M54.5 12.5 L54.5 19 M54.5 12.5 L48 12.5"
        stroke="#2fd67a"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
