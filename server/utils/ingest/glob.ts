// Tiny glob → RegExp matcher (supports `**`, `*`, `?`, `{a,b}` and `[...]`), no dependencies.
// Patterns without a slash match at any depth (like .gitignore), a trailing slash means "everything below".

const cache = new Map<string, RegExp>()

export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob)
  if (cached) return cached

  let pattern = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (pattern.endsWith('/')) pattern += '**'
  if (!pattern.includes('/')) pattern = `**/${pattern}`

  let re = ''
  let braceDepth = 0
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        const atSegmentStart = i === 0 || pattern[i - 1] === '/'
        if (pattern[i + 2] === '/' && atSegmentStart) {
          re += '(?:.*/)?'
          i += 2
        }
        else {
          re += '.*'
          i += 1
        }
      }
      else {
        re += '[^/]*'
      }
    }
    else if (c === '?') {
      re += '[^/]'
    }
    else if (c === '{') {
      braceDepth++
      re += '(?:'
    }
    else if (c === '}' && braceDepth > 0) {
      braceDepth--
      re += ')'
    }
    else if (c === ',' && braceDepth > 0) {
      re += '|'
    }
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) {
        re += '\\['
      }
      else {
        let cls = pattern.slice(i + 1, end).replace(/\\/g, '\\\\')
        if (cls.startsWith('!')) cls = `^${cls.slice(1)}`
        re += `[${cls}]`
        i = end
      }
    }
    else {
      re += c.replace(/[.+^$()|\]}]/g, '\\$&')
    }
  }
  while (braceDepth-- > 0) re += ')'

  const regex = new RegExp(`^${re}$`, 'i')
  cache.set(glob, regex)
  return regex
}

export function matchesAnyGlob(path: string, globs: string[]): boolean {
  return globs.some(g => globToRegExp(g).test(path))
}
