export default function VersionBadge({ version }) {
  return (
    <span style={{ fontSize: 10, color: '#bbb', letterSpacing: '0.05em' }}>
      {version}-<a
        href={`https://github.com/matmaxx2317/endermatx/commit/${__GIT_HASH_FULL__}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'none' }}
      >{__GIT_HASH__}</a>
    </span>
  )
}
