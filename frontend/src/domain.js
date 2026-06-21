// matthiasweigel.com is a wmt-only mirror shown to Tipprunde opponents —
// it must never expose the rest of the site (navigation, other tools).
const WMT_ONLY_HOSTS = ['matthiasweigel.com', 'www.matthiasweigel.com']

export function isWmtOnlyDomain() {
  return WMT_ONLY_HOSTS.includes(window.location.hostname)
}

// The update log (scheduler run history) is only exposed on matmaxx.org.
const UPDATE_LOG_HOSTS = ['matmaxx.org', 'www.matmaxx.org']

export function isUpdateLogDomain() {
  return UPDATE_LOG_HOSTS.includes(window.location.hostname)
}
