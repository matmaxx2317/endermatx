// matthiasweigel.com is a wmt-only mirror shown to Tipprunde opponents —
// it must never expose the rest of the site (navigation, other tools).
const WMT_ONLY_HOSTS = ['matthiasweigel.com', 'www.matthiasweigel.com']

export function isWmtOnlyDomain() {
  return WMT_ONLY_HOSTS.includes(window.location.hostname)
}
