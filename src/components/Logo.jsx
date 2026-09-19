export default function Logo({ onClick }) {
  const Tag = onClick ? 'button' : 'a';
  const props = onClick
    ? { type: 'button', onClick }
    : { href: '/' };
  return (
    <Tag className="brand" aria-label="Forvi home" {...props}>
      <span className="brand-mark" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </span>
      <span className="brand-name">Forvi</span>
    </Tag>
  );
}
