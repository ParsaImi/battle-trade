let uid = 0;

export default function CoinIcon({ size = 18 }) {
  const gradId = `coinGrad${uid++}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="coin-icon" aria-hidden="true">
      <defs>
        <radialGradient id={gradId} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffe38a" />
          <stop offset="55%" stopColor="#ffc93c" />
          <stop offset="100%" stopColor="#d99a12" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill={`url(#${gradId})`} stroke="#a8730a" strokeWidth="1" />
      <circle cx="12" cy="12" r="7.6" fill="none" stroke="#a8730a" strokeWidth="1" opacity="0.5" />
      <path
        d="M7.5 13.5 L10.3 9.8 L12.4 12 L16.5 7.8"
        stroke="#7a5206"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
