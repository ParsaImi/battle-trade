import { avatarName, avatarSrc } from './avatars';

// Single place that renders a player avatar image, so swapping the art
// (or the file format) only ever touches avatars.js.
export default function Avatar({ id, className = '', alt }) {
  return (
    <img
      className={`avatar-img ${className}`}
      src={avatarSrc(id)}
      alt={alt ?? avatarName(id)}
      draggable="false"
    />
  );
}
